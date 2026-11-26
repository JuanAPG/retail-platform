"""Calidad por fuente (DG-7) y frescura (DG-8), con lo que exponen los dueños.

Cada métrica trae numerador y denominador. Si no se puede medir sale `disponible: false` con
motivo y sin valor: nunca 0 (D-20). Las funciones reciben los conteos ya leídos; no hacen HTTP.
"""
from __future__ import annotations

from datetime import date

METRICAS = ("completeness", "duplicates", "outOfRange", "freshness")


def es_campo_vacio(codigo: str) -> bool:
    """DG-7: un rechazo por campo vacío termina en `_VACIO` o `_VACIA`; todo lo demás es fuera de rango."""
    return codigo.endswith("_VACIO") or codigo.endswith("_VACIA")


def proporcion(metrica: str, numerador: int, denominador: int, motivo: str | None = None) -> dict:
    if denominador <= 0:
        return no_disponible(metrica, "No hay registros en la ventana para medir.")
    return {"metric": metrica, "value": numerador / denominador, "unit": "proporcion", "numerator": numerador,
            "denominator": denominador, "disponible": True, "motivo": motivo}


def dias(metrica: str, valor: int, limite: int) -> dict:
    """Frescura en días: vencida (`stale`) con MÁS de `limite` días. 7 → vigente; 8 → vencida."""
    return {"metric": metrica, "value": float(valor), "unit": "dias", "numerator": None, "denominator": None,
            "disponible": True, "motivo": None, "stale": valor > limite}


def no_disponible(metrica: str, motivo: str, unidad: str | None = None) -> dict:
    unidad = unidad or ("dias" if metrica == "freshness" else "proporcion")
    return {"metric": metrica, "value": None, "unit": unidad, "numerator": None, "denominator": None,
            "disponible": False, "motivo": motivo}


def ventas_archivo(lotes: list[dict], rechazos: dict[str, int] | None, motivo_rechazos: str | None,
                   ultimo_confirmado: date | None, hoy: date, limite_dias: int) -> dict:
    """`ventas-archivo`: lotes de ingestion en la ventana, sin los descartados.

    `lotes`: `[{counts: {valid, repeated, rejected, conflicts}}]`. `rechazos`: código → filas (None si
    no se pudieron leer: completitud y fuera de rango quedan no disponibles con `motivo_rechazos`).
    """
    filas = sum(sum(l["counts"][k] for k in ("valid", "repeated", "rejected", "conflicts")) for l in lotes)
    repetidas = sum(l["counts"]["repeated"] + l["counts"]["conflicts"] for l in lotes)
    if rechazos is None:
        completitud = no_disponible("completeness", motivo_rechazos)
        fuera = no_disponible("outOfRange", motivo_rechazos)
    else:
        vacias = sum(n for codigo, n in rechazos.items() if es_campo_vacio(codigo))
        completitud = proporcion("completeness", filas - vacias, filas)
        fuera = proporcion("outOfRange", sum(rechazos.values()) - vacias, filas)
    frescura = (dias("freshness", (hoy - ultimo_confirmado).days, limite_dias) if ultimo_confirmado
                else no_disponible("freshness", "No hay ningún lote confirmado todavía."))
    return {"sampleSize": filas, "metrics": [completitud, proporcion("duplicates", repetidas, filas), fuera, frescura],
            "rejectedByCode": [{"code": c, "count": n} for c, n in sorted((rechazos or {}).items())]}


def capturas_campo(capturas: int, en_conflicto: int, existencias: int, vencidas: int,
                   motivo_ventana: str | None) -> dict:
    """`capturas-campo` (availability): duplicados = capturas en conflicto (D-42); frescura =
    existencias vigentes / existencias (D-38). Completitud y fuera de rango no se pueden medir:
    availability rechaza esas capturas antes de guardarlas."""
    return {"sampleSize": capturas, "metrics": [
        no_disponible("completeness", "availability-service rechaza una captura incompleta antes de guardarla: "
                                      "no hay incompletas que medir."),
        proporcion("duplicates", en_conflicto, capturas, motivo_ventana),
        no_disponible("outOfRange", "availability-service rechaza existencias negativas o fechas futuras antes "
                                    "de guardarlas."),
        proporcion("freshness", existencias - vencidas, existencias),
    ], "rejectedByCode": []}


def inegi_enigh(vigentes_desde: list[date], hoy: date, limite_dias: int) -> dict:
    """`inegi-enigh`: días desde la versión vigente más vieja de los segmentos (DG-8, 365)."""
    if not vigentes_desde:
        return {"sampleSize": 0, "metrics": [no_disponible("freshness", "No hay segmentos con versión vigente.")],
                "rejectedByCode": []}
    return {"sampleSize": len(vigentes_desde),
            "metrics": [dias("freshness", (hoy - min(vigentes_desde)).days, limite_dias)], "rejectedByCode": []}


def fuente_caida(metricas: tuple[str, ...], motivo: str) -> dict:
    """Un dueño que no responde deja solo SU fuente sin medir, no tumba el reporte (DG-7)."""
    return {"sampleSize": None, "metrics": [no_disponible(m, motivo) for m in metricas], "rejectedByCode": []}
