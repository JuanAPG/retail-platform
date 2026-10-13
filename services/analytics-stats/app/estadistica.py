"""RF-20 a RF-22 — Pruebas estadísticas como funciones puras: sin HTTP, sin
base de datos. Reciben los grupos ya armados y devuelven el resultado del
contrato (`docs/contratos/analytics-stats.md`), salvo `source`, que pone la ruta.

El cálculo es el de scipy y statsmodels, sin redondear: las pruebas lo
comparan contra esas bibliotecas a 1e-9 (QA STA-02). Todo sale en tipos
nativos de Python: un `numpy.bool_` se serializa "True" en XML, que no es un
`xs:boolean` válido, y un `numpy.float64` no lo acepta el JSON de Starlette.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import stats
from statsmodels.stats.proportion import proportions_chisquare, proportions_ztest

MIN_POR_GRUPO = 2
#: Con menos valores en algún grupo, `auto` usa Mann-Whitney en lugar de Welch.
MIN_PARA_WELCH = 8
MAX_GRUPOS = 20
MAX_VALORES = 100_000
#: Conteo esperado mínimo para la aproximación normal (z) o χ².
ESPERADO_MINIMO = 5


class DatosInvalidos(ValueError):
    """Datos con los que la prueba no se puede calcular: la ruta responde 400."""


@dataclass(frozen=True)
class Grupo:
    label: str
    values: list[float]


@dataclass(frozen=True)
class Conteo:
    label: str
    successes: int
    total: int


# --- Hipótesis (RF-20) ---------------------------------------------------

def prueba_dos_grupos(
    grupos: list[Grupo],
    method: str = "auto",
    alternative: str = "two-sided",
    alpha: float = 0.05,
    que: str | None = None,
) -> dict:
    """Welch o Mann-Whitney entre dos grupos.

    `auto` usa Welch salvo que algún grupo tenga menos de `MIN_PARA_WELCH`
    valores. `que` nombra lo que se compara en la conclusión (p. ej. "el
    ticket"); sin él la conclusión habla de los grupos.
    """
    _validar_valores(grupos, minimo=2, maximo=2)
    a, b = (np.asarray(g.values, dtype=float) for g in grupos)
    pocos = min(len(a), len(b)) < MIN_PARA_WELCH
    prueba = method if method != "auto" else ("mannwhitney" if pocos else "welch")

    supuestos: list[str] = []
    if prueba == "welch":
        if _constante(a) and _constante(b):
            raise DatosInvalidos(
                "Los dos grupos no tienen variación (todos sus valores son iguales): "
                "la prueba de Welch no se puede calcular.")
        resultado = stats.ttest_ind(a, b, equal_var=False, alternative=alternative)
        estadistico, p, gl = float(resultado.statistic), float(resultado.pvalue), float(resultado.df)
        supuestos.append("Welch: no supone que los dos grupos tengan la misma varianza.")
        if pocos:
            supuestos.append(
                f"Algún grupo tiene menos de {MIN_PARA_WELCH} valores: Welch depende de que "
                "los datos sean cercanos a la normal.")
    else:
        if _constante(np.concatenate([a, b])):
            raise DatosInvalidos("Todos los valores son iguales: no hay diferencia que medir.")
        resultado = stats.mannwhitneyu(a, b, alternative=alternative)
        estadistico, p, gl = float(resultado.statistic), float(resultado.pvalue), None
        motivo = "se pidió" if method == "mannwhitney" else f"algún grupo tiene menos de {MIN_PARA_WELCH} valores"
        supuestos.append(f"Mann-Whitney ({motivo}): compara rangos, no medias, y no supone distribución normal.")
    supuestos.append("Grupos independientes: cada valor pertenece a un solo grupo.")
    if alternative != "two-sided":
        sentido = "mayor" if alternative == "greater" else "menor"
        supuestos.append(f"Hipótesis alternativa de un lado: {grupos[0].label} {sentido} que {grupos[1].label}.")

    rechaza = p < alpha
    return {
        "test": prueba,
        "statistic": estadistico,
        "pValue": p,
        "degreesOfFreedom": gl,
        "alpha": alpha,
        "alternative": alternative,
        "rejectNull": rechaza,
        "conclusion": _conclusion_dos(grupos[0].label, grupos[1].label, alternative, rechaza, p, alpha, que),
        "groups": [_resumen(g) for g in grupos],
        "assumptions": supuestos,
    }


# --- ANOVA (RF-21) ---------------------------------------------------------

def anova(grupos: list[Grupo], alpha: float = 0.05, que: str | None = None) -> dict:
    """ANOVA de un factor. Con dos grupos se resuelve con `prueba_dos_grupos`."""
    if len(grupos) < 2:
        raise DatosInvalidos(f"ANOVA compara al menos 2 grupos; llegó {len(grupos)}.")
    if len(grupos) == 2:
        dos = prueba_dos_grupos(grupos, "auto", "two-sided", alpha, que)
        nombre = "Welch" if dos["test"] == "welch" else "Mann-Whitney"
        return {
            "test": dos["test"],
            "statistic": dos["statistic"],
            "pValue": dos["pValue"],
            "dfBetween": None,
            "dfWithin": None,
            "degreesOfFreedom": dos["degreesOfFreedom"],
            "alpha": alpha,
            "rejectNull": dos["rejectNull"],
            "conclusion": dos["conclusion"],
            "groups": dos["groups"],
            "assumptions": [
                f"Con dos grupos, ANOVA se resuelve con la prueba de dos grupos ({nombre}), "
                "igual que POST /v1/hypothesis/test.",
                *dos["assumptions"],
            ],
        }

    _validar_valores(grupos, minimo=3, maximo=MAX_GRUPOS)
    datos = [np.asarray(g.values, dtype=float) for g in grupos]
    if all(_constante(x) for x in datos):
        raise DatosInvalidos(
            "Ningún grupo tiene variación (dentro de cada uno todos los valores son iguales): "
            "ANOVA no se puede calcular.")
    resultado = stats.f_oneway(*datos)
    k, total = len(datos), sum(len(x) for x in datos)
    p = float(resultado.pvalue)
    rechaza = p < alpha

    supuestos = ["ANOVA de un factor: supone varianzas parecidas entre grupos y datos cercanos a la normal en cada uno."]
    if any(len(x) < MIN_PARA_WELCH for x in datos):
        supuestos.append(f"Algún grupo tiene menos de {MIN_PARA_WELCH} valores: el resultado es menos confiable.")
    supuestos.append("Grupos independientes: cada valor pertenece a un solo grupo.")
    supuestos.append("ANOVA dice si al menos un grupo difiere de los demás, no cuál.")

    en = f" en {que}" if que else ""
    if rechaza:
        conclusion = (f"Con α = {alpha:g} al menos uno de los {k} grupos difiere de los demás{en} ({_p(p)}). "
                      "Es una diferencia en estos datos; no prueba una causa.")
    else:
        conclusion = (f"Con α = {alpha:g} no hay evidencia suficiente de diferencia{en} entre los {k} grupos "
                      f"({_p(p)}). No significa que sean iguales.")
    return {
        "test": "anova",
        "statistic": float(resultado.statistic),
        "pValue": p,
        "dfBetween": k - 1,
        "dfWithin": total - k,
        "degreesOfFreedom": None,
        "alpha": alpha,
        "rejectNull": rechaza,
        "conclusion": conclusion,
        "groups": [_resumen(g) for g in grupos],
        "assumptions": supuestos,
    }


# --- Proporciones (RF-22) ---------------------------------------------------

def comparar_proporciones(conteos: list[Conteo], alpha: float = 0.05, que: str | None = None) -> dict:
    """z de dos proporciones (Fisher si algún esperado es menor a 5) o χ² con 3+.

    `que` describe el caso contado (p. ej. "de canastas con productos básicos").
    """
    _validar_conteos(conteos)
    exitos = np.array([c.successes for c in conteos], dtype=float)
    totales = np.array([c.total for c in conteos], dtype=float)
    combinada = exitos.sum() / totales.sum()
    esperados = np.concatenate([totales * combinada, totales * (1 - combinada)])
    pocos = bool((esperados < ESPERADO_MINIMO).any())

    supuestos: list[str] = []
    diferencia = None
    gl = None
    if len(conteos) == 2:
        (s1, s2), (n1, n2) = (c.successes for c in conteos), (c.total for c in conteos)
        diferencia = s1 / n1 - s2 / n2
        if pocos:
            razon, p = stats.fisher_exact([[s1, n1 - s1], [s2, n2 - s2]])
            prueba = "fisher"
            estadistico = float(razon) if math.isfinite(razon) else None
            supuestos.append(
                f"Algún conteo esperado es menor a {ESPERADO_MINIMO}: se usó la prueba exacta de Fisher "
                "en lugar de z; `statistic` es la razón de momios.")
            if estadistico is None:
                supuestos.append("La razón de momios no es finita (algún grupo sin casos en una categoría): se omite.")
        else:
            z, p = proportions_ztest(exitos, totales)
            prueba, estadistico = "ztest", float(z)
            supuestos.append("Prueba z de dos proporciones con la proporción combinada, de dos lados.")
    else:
        if combinada in (0, 1):
            raise DatosInvalidos("Todos los grupos tienen proporción 0 (o todos 1): no hay variación que comparar.")
        chi2, p, _ = proportions_chisquare(exitos, totales)
        prueba, estadistico, gl = "chisquare", float(chi2), len(conteos) - 1
        supuestos.append("χ² de homogeneidad: si la proporción es la misma en todos los grupos.")
        if pocos:
            supuestos.append(f"Hay conteos esperados menores a {ESPERADO_MINIMO}: el resultado de χ² es menos confiable.")
    supuestos.append("Grupos independientes: cada caso pertenece a un solo grupo.")

    p = float(p)
    rechaza = p < alpha
    cual = f"la proporción {que}" if que else "la proporción"
    entre = f"{_y(conteos[0].label, conteos[1].label)}" if len(conteos) == 2 else f"al menos dos de los {len(conteos)} grupos"
    if rechaza:
        conclusion = (f"Con α = {alpha:g} {cual} difiere entre {entre} ({_p(p)}). "
                      "Es una diferencia en estos datos; no prueba una causa.")
    else:
        todos = entre if len(conteos) == 2 else f"los {len(conteos)} grupos"
        conclusion = (f"Con α = {alpha:g} no hay evidencia suficiente de que {cual} difiera entre {todos} "
                      f"({_p(p)}). No significa que sean iguales.")
    return {
        "test": prueba,
        "statistic": estadistico,
        "pValue": p,
        "degreesOfFreedom": gl,
        "difference": diferencia,
        "alpha": alpha,
        "rejectNull": rechaza,
        "conclusion": conclusion,
        "groups": [{"label": c.label, "successes": c.successes, "total": c.total,
                    "proportion": c.successes / c.total} for c in conteos],
        "assumptions": supuestos,
    }


# --- Validación y textos ---------------------------------------------------

def _validar_valores(grupos: list[Grupo], minimo: int, maximo: int) -> None:
    if not minimo <= len(grupos) <= maximo:
        rango = f"exactamente {minimo}" if minimo == maximo else f"de {minimo} a {maximo}"
        raise DatosInvalidos(f"Esta prueba compara {rango} grupos; llegaron {len(grupos)}.")
    _etiquetas_unicas(grupos)
    total = sum(len(g.values) for g in grupos)
    if total > MAX_VALORES:
        raise DatosInvalidos(f"Se comparan hasta {MAX_VALORES} valores en total; llegaron {total}.")
    for g in grupos:
        if len(g.values) < MIN_POR_GRUPO:
            raise DatosInvalidos(
                f"El grupo «{g.label}» tiene {len(g.values)} valor(es); se necesitan al menos {MIN_POR_GRUPO}.")


def _validar_conteos(conteos: list[Conteo]) -> None:
    if not 2 <= len(conteos) <= MAX_GRUPOS:
        raise DatosInvalidos(f"Se comparan de 2 a {MAX_GRUPOS} grupos; llegaron {len(conteos)}.")
    _etiquetas_unicas(conteos)
    for c in conteos:
        if c.total < 1:
            raise DatosInvalidos(f"El grupo «{c.label}» tiene total {c.total}; debe ser al menos 1.")
        if not 0 <= c.successes <= c.total:
            raise DatosInvalidos(
                f"El grupo «{c.label}» tiene {c.successes} casos de {c.total}; deben estar entre 0 y el total.")


def _etiquetas_unicas(grupos: list[Grupo] | list[Conteo]) -> None:
    vistas: set[str] = set()
    for g in grupos:
        if g.label in vistas:
            raise DatosInvalidos(f"El grupo «{g.label}» está repetido.")
        vistas.add(g.label)


def _constante(valores: np.ndarray) -> bool:
    return bool(np.ptp(valores) == 0)


def _resumen(grupo: Grupo) -> dict:
    valores = np.asarray(grupo.values, dtype=float)
    return {
        "label": grupo.label,
        "n": len(valores),
        "mean": float(valores.mean()),
        "median": float(np.median(valores)),
        "standardDeviation": float(valores.std(ddof=1)),
    }


def _conclusion_dos(a: str, b: str, alternative: str, rechaza: bool, p: float, alpha: float, que: str | None) -> str:
    en = f" en {que}" if que else ""
    if alternative == "two-sided":
        if rechaza:
            return (f"Con α = {alpha:g} hay diferencia estadística{en} entre {_y(a, b)} ({_p(p)}). "
                    "Es una diferencia en estos datos; no prueba una causa.")
        return (f"Con α = {alpha:g} no hay evidencia suficiente de diferencia{en} entre {_y(a, b)} "
                f"({_p(p)}). No significa que sean iguales.")
    verbo = "supera a" if alternative == "greater" else "queda por debajo de"
    if rechaza:
        return (f"Con α = {alpha:g} hay evidencia de que {a} {verbo} {b}{en} ({_p(p)}). "
                "Es una diferencia en estos datos; no prueba una causa.")
    subjuntivo = "supere a" if alternative == "greater" else "quede por debajo de"
    return f"Con α = {alpha:g} no hay evidencia suficiente de que {a} {subjuntivo} {b}{en} ({_p(p)})."


def _p(p: float) -> str:
    return "p < 0.0001" if p < 0.0001 else f"p = {p:.4f}"


def _y(a: str, b: str) -> str:
    """"Ingreso alto e Ingreso bajo": antes de i- o hi- la conjunción es "e"."""
    siguiente = b.lower()
    e = siguiente.startswith(("i", "hi")) and not siguiente.startswith(("ie", "hie"))
    return f"{a} {'e' if e else 'y'} {b}"
