"""STA-02: cada prueba contra scipy y statsmodels con tolerancia explícita de
1e-9, en al menos 3 conjuntos de datos, más los casos de control de QA."""
import math

import numpy as np
import pytest
from scipy import stats
from statsmodels.stats.proportion import proportions_chisquare, proportions_ztest

from app.estadistica import (
    MAX_VALORES,
    Conteo,
    DatosInvalidos,
    Grupo,
    anova,
    comparar_proporciones,
    prueba_dos_grupos,
)

TOL = 1e-9


def cerca(obtenido: float, esperado: float) -> bool:
    return math.isclose(obtenido, esperado, rel_tol=TOL, abs_tol=TOL)


# Conjunto publicado: largo de la cicatriz del músculo aductor de mejillones en
# cinco sitios (McDonald et al., 1991). Es el ejemplo de la documentación de
# scipy.stats.f_oneway, con F = 7.121019471642447 y p = 0.0002812242314534544.
TILLAMOOK = [0.0571, 0.0813, 0.0831, 0.0976, 0.0817, 0.0859, 0.0735, 0.0659, 0.0923, 0.0836]
NEWPORT = [0.0873, 0.0662, 0.0672, 0.0819, 0.0749, 0.0649, 0.0835, 0.0725]
PETERSBURG = [0.0974, 0.1352, 0.0817, 0.1016, 0.0968, 0.1064, 0.105]
MAGADAN = [0.1033, 0.0915, 0.0781, 0.0685, 0.0677, 0.0697, 0.0764, 0.0689]
TVARMINNE = [0.0703, 0.1026, 0.0956, 0.0973, 0.1039, 0.1045]

_azar = np.random.default_rng(2026)
#: Tres conjuntos de dos grupos: con diferencia, sin diferencia y sesgados.
PARES = [
    (list(_azar.normal(100, 15, 40)), list(_azar.normal(112, 25, 35))),
    (list(_azar.normal(50, 5, 12)), list(_azar.normal(50, 5, 15))),
    (list(_azar.exponential(80, 30)), list(_azar.exponential(60, 45))),
]


def dos(a, b, etiquetas=("A", "B")):
    return [Grupo(etiquetas[0], list(a)), Grupo(etiquetas[1], list(b))]


# --- Hipótesis -------------------------------------------------------------

@pytest.mark.parametrize("a,b", PARES)
@pytest.mark.parametrize("alternative", ["two-sided", "greater", "less"])
def test_welch_igual_a_scipy(a, b, alternative):
    r = prueba_dos_grupos(dos(a, b), "welch", alternative)
    ref = stats.ttest_ind(a, b, equal_var=False, alternative=alternative)

    assert r["test"] == "welch"
    assert cerca(r["statistic"], ref.statistic)
    assert cerca(r["pValue"], ref.pvalue)
    assert cerca(r["degreesOfFreedom"], ref.df)
    assert r["rejectNull"] is bool(ref.pvalue < 0.05)


@pytest.mark.parametrize("a,b", PARES)
def test_welch_contra_la_formula(a, b):
    # t y grados de libertad de Welch-Satterthwaite escritos a mano.
    va, vb = np.var(a, ddof=1) / len(a), np.var(b, ddof=1) / len(b)
    t = (np.mean(a) - np.mean(b)) / math.sqrt(va + vb)
    gl = (va + vb) ** 2 / (va**2 / (len(a) - 1) + vb**2 / (len(b) - 1))

    r = prueba_dos_grupos(dos(a, b), "welch")

    assert cerca(r["statistic"], t)
    assert cerca(r["degreesOfFreedom"], gl)


@pytest.mark.parametrize("a,b", PARES)
@pytest.mark.parametrize("alternative", ["two-sided", "greater"])
def test_mann_whitney_igual_a_scipy(a, b, alternative):
    r = prueba_dos_grupos(dos(a, b), "mannwhitney", alternative)
    ref = stats.mannwhitneyu(a, b, alternative=alternative)

    assert r["test"] == "mannwhitney"
    assert cerca(r["statistic"], ref.statistic)
    assert cerca(r["pValue"], ref.pvalue)
    assert r["degreesOfFreedom"] is None
    assert any("se pidió" in s for s in r["assumptions"])


def test_auto_usa_mann_whitney_si_algun_grupo_tiene_menos_de_8():
    ocho = [1.0, 2.5, 3.1, 4.8, 5.2, 6.6, 7.0, 8.4]

    assert prueba_dos_grupos(dos(ocho, [v + 2 for v in ocho]))["test"] == "welch"
    con_siete = prueba_dos_grupos(dos(ocho, [v + 2 for v in ocho[:7]]))
    assert con_siete["test"] == "mannwhitney"
    assert any("menos de 8" in s for s in con_siete["assumptions"])


def test_resumen_de_cada_grupo():
    a, b = PARES[0]
    grupo = prueba_dos_grupos(dos(a, b))["groups"][0]

    assert grupo["n"] == len(a)
    assert cerca(grupo["mean"], np.mean(a))
    assert cerca(grupo["median"], np.median(a))
    assert cerca(grupo["standardDeviation"], np.std(a, ddof=1))


# --- ANOVA -----------------------------------------------------------------

def test_anova_da_el_valor_publicado_de_los_mejillones():
    grupos = [Grupo(n, v) for n, v in [("Tillamook", TILLAMOOK), ("Newport", NEWPORT), ("Petersburg", PETERSBURG),
                                         ("Magadan", MAGADAN), ("Tvarminne", TVARMINNE)]]
    r = anova(grupos)

    assert r["test"] == "anova"
    assert cerca(r["statistic"], 7.121019471642447)
    assert cerca(r["pValue"], 0.0002812242314534544)
    assert (r["dfBetween"], r["dfWithin"]) == (4, 39 - 5)
    assert r["rejectNull"] is True


@pytest.mark.parametrize("k", [3, 4, 6])
def test_anova_igual_a_scipy(k):
    azar = np.random.default_rng(k)
    datos = [list(azar.normal(100 + 4 * i, 10 + i, 20 + i)) for i in range(k)]
    r = anova([Grupo(f"G{i}", v) for i, v in enumerate(datos)])
    ref = stats.f_oneway(*datos)

    assert cerca(r["statistic"], ref.statistic)
    assert cerca(r["pValue"], ref.pvalue)
    assert (r["dfBetween"], r["dfWithin"]) == (k - 1, sum(map(len, datos)) - k)


def test_anova_con_dos_grupos_se_resuelve_con_la_prueba_de_dos_grupos():
    a, b = PARES[0]
    r = anova(dos(a, b))
    ref = stats.ttest_ind(a, b, equal_var=False)

    assert r["test"] == "welch"
    assert cerca(r["statistic"], ref.statistic)
    assert cerca(r["pValue"], ref.pvalue)
    assert r["dfBetween"] is None and r["dfWithin"] is None
    assert "hypothesis/test" in r["assumptions"][0]


def test_anova_con_un_grupo_es_400():
    with pytest.raises(DatosInvalidos, match="al menos 2 grupos"):
        anova([Grupo("A", [1.0, 2.0, 3.0])])


# --- Proporciones ----------------------------------------------------------

CONTEOS_Z = [((30, 42), (12, 30)), ((120, 300), (150, 310)), ((45, 90), (44, 90))]


@pytest.mark.parametrize("g1,g2", CONTEOS_Z)
def test_z_igual_a_statsmodels_y_a_la_formula(g1, g2):
    (s1, n1), (s2, n2) = g1, g2
    r = comparar_proporciones([Conteo("A", s1, n1), Conteo("B", s2, n2)])
    z, p = proportions_ztest([s1, s2], [n1, n2])
    combinada = (s1 + s2) / (n1 + n2)
    a_mano = (s1 / n1 - s2 / n2) / math.sqrt(combinada * (1 - combinada) * (1 / n1 + 1 / n2))

    assert r["test"] == "ztest"
    assert cerca(r["statistic"], z) and cerca(r["statistic"], a_mano)
    assert cerca(r["pValue"], p)
    assert cerca(r["difference"], s1 / n1 - s2 / n2)


def test_fisher_si_algun_conteo_esperado_es_menor_a_5():
    # El té de Fisher: 3 de 4 contra 1 de 4. p exacta de dos lados = 17/35.
    r = comparar_proporciones([Conteo("Leche primero", 3, 4), Conteo("Té primero", 1, 4)])

    assert r["test"] == "fisher"
    assert cerca(r["pValue"], 17 / 35)
    assert cerca(r["statistic"], 9.0)  # razón de momios (3·3)/(1·1)
    assert any("Fisher" in s for s in r["assumptions"])


# Conteos esperados menores a 5 con la proporción combinada: 2.5, 3.8 y 1.
@pytest.mark.parametrize("tabla", [((1, 10), (4, 10)), ((1, 30), (6, 25)), ((28, 30), (30, 30))])
def test_fisher_igual_a_scipy(tabla):
    (s1, n1), (s2, n2) = tabla
    r = comparar_proporciones([Conteo("A", s1, n1), Conteo("B", s2, n2)])
    razon, p = stats.fisher_exact([[s1, n1 - s1], [s2, n2 - s2]])

    assert r["test"] == "fisher"
    assert cerca(r["pValue"], p)
    assert cerca(r["statistic"], razon)


def test_el_corte_de_fisher_es_un_esperado_menor_a_5():
    # Combinada 10/20: esperados de exactamente 5 → z. Combinada 9/20: 4.5 → Fisher.
    assert comparar_proporciones([Conteo("A", 2, 10), Conteo("B", 8, 10)])["test"] == "ztest"
    assert comparar_proporciones([Conteo("A", 1, 10), Conteo("B", 8, 10)])["test"] == "fisher"


def test_fisher_con_razon_de_momios_infinita_la_omite():
    r = comparar_proporciones([Conteo("A", 5, 5), Conteo("B", 0, 5)])

    assert r["test"] == "fisher" and r["statistic"] is None
    assert any("no es finita" in s for s in r["assumptions"])


@pytest.mark.parametrize("conteos", [
    [(32, 42), (34, 40), (20, 30)],
    [(10, 50), (25, 60), (30, 55), (12, 40)],
    [(100, 200), (110, 200), (90, 200)],
])
def test_chi_cuadrada_igual_a_statsmodels_y_a_scipy(conteos):
    exitos, totales = [s for s, _ in conteos], [n for _, n in conteos]
    r = comparar_proporciones([Conteo(f"G{i}", s, n) for i, (s, n) in enumerate(conteos)])
    chi2, p, _ = proportions_chisquare(exitos, totales)
    # Otra implementación: tabla de contingencia sin corrección de Yates.
    tabla = stats.chi2_contingency([[s, n - s] for s, n in conteos], correction=False)

    assert r["test"] == "chisquare"
    assert cerca(r["statistic"], chi2) and cerca(r["statistic"], tabla.statistic)
    assert cerca(r["pValue"], p) and cerca(r["pValue"], tabla.pvalue)
    assert r["degreesOfFreedom"] == len(conteos) - 1
    assert r["difference"] is None


# --- Casos de control de QA ------------------------------------------------

@pytest.mark.parametrize("llamada,mensaje", [
    (lambda: prueba_dos_grupos(dos([1.0], [2.0, 3.0])), "al menos 2"),
    (lambda: prueba_dos_grupos(dos([4.0, 4.0, 4.0], [7.0, 7.0]), "welch"), "no tienen variación"),
    (lambda: prueba_dos_grupos(dos([5.0, 5.0], [5.0, 5.0]), "mannwhitney"), "Todos los valores son iguales"),
    (lambda: prueba_dos_grupos([Grupo("A", [1.0, 2.0])]), "exactamente 2"),
    (lambda: prueba_dos_grupos(dos([1.0, 2.0], [3.0, 4.0], ("A", "A"))), "repetido"),
    (lambda: anova([Grupo("A", [1.0, 1.0]), Grupo("B", [2.0, 2.0]), Grupo("C", [3.0, 3.0])]), "Ningún grupo"),
    (lambda: comparar_proporciones([Conteo("A", 5, 4), Conteo("B", 1, 4)]), "entre 0 y el total"),
    (lambda: comparar_proporciones([Conteo("A", 0, 0), Conteo("B", 1, 4)]), "total 0"),
    (lambda: comparar_proporciones([Conteo("A", 0, 4), Conteo("B", 0, 5), Conteo("C", 0, 6)]), "proporción 0"),
    (lambda: prueba_dos_grupos(dos([1.0] * MAX_VALORES, [2.0, 3.0])), "hasta"),
])
def test_casos_de_control_dan_400_con_su_motivo(llamada, mensaje):
    with pytest.raises(DatosInvalidos, match=mensaje):
        llamada()


def test_un_grupo_constante_no_impide_welch():
    r = prueba_dos_grupos(dos([4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0], list(PARES[0][1])), "welch")

    assert math.isfinite(r["statistic"])


# --- Forma del resultado ---------------------------------------------------

def _solo_tipos_nativos(valor) -> bool:
    if isinstance(valor, dict):
        return all(_solo_tipos_nativos(v) for v in valor.values())
    if isinstance(valor, list):
        return all(_solo_tipos_nativos(v) for v in valor)
    return type(valor) in (str, int, float, bool, type(None))


@pytest.mark.parametrize("resultado", [
    lambda: prueba_dos_grupos(dos(*PARES[0])),
    lambda: prueba_dos_grupos(dos(*PARES[0]), "mannwhitney"),
    lambda: anova([Grupo(f"G{i}", list(PARES[i][0])) for i in range(3)]),
    lambda: comparar_proporciones([Conteo("A", 30, 42), Conteo("B", 12, 30)]),
    lambda: comparar_proporciones([Conteo("A", 3, 4), Conteo("B", 1, 4)]),
    lambda: comparar_proporciones([Conteo("A", 30, 42), Conteo("B", 12, 30), Conteo("C", 20, 25)]),
])
def test_todo_sale_en_tipos_nativos_de_python(resultado):
    # numpy.bool_ saldría "True" en XML y numpy.float64 rompe el JSON de Starlette.
    assert _solo_tipos_nativos(resultado())


def test_la_conclusion_es_un_indicio_y_no_una_causa():
    a, b = PARES[0]
    con_diferencia = prueba_dos_grupos(dos(a, b, ("Ingreso alto", "Ingreso bajo")))
    sin_diferencia = prueba_dos_grupos(dos(a, a, ("Zona Centro", "Zona Valle")))

    assert "Ingreso alto e Ingreso bajo" in con_diferencia["conclusion"]
    assert con_diferencia["conclusion"].endswith("no prueba una causa.")
    assert sin_diferencia["rejectNull"] is False
    assert sin_diferencia["conclusion"].endswith("No significa que sean iguales.")
