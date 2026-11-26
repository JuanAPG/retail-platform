"""Periodos del calendario en hora de Monterrey: evolución (semanas/meses), semanas para
`basketsPerWeek` y versiones del segmento en un periodo (BA-6, D-35).

Semanas de lunes a domingo y meses calendario. El primer y el último periodo de la evolución
pueden quedar parciales (los recorta `dateFrom`/`dateTo`) y lo dicen `periodStart`/`periodEnd`.
"""
from __future__ import annotations

from datetime import date, timedelta

from .dominio import MAX_MESES, MAX_SEMANAS, ErrorDominio


def lunes_de(dia: date) -> date:
    return dia - timedelta(days=dia.weekday())


def _siguiente_mes(dia: date) -> date:
    return date(dia.year + dia.month // 12, dia.month % 12 + 1, 1)


def inicio_de(dia: date, granularidad: str) -> date:
    """La clave con que core-process agrupa (`periodStart`): lunes o día 1 del mes."""
    return lunes_de(dia) if granularidad == "week" else dia.replace(day=1)


def periodos(desde: date, hasta: date, granularidad: str) -> list[dict]:
    """`[{periodStart, periodEnd, key}]` de `desde` a `hasta`, sin huecos.

    `key` es el inicio completo del periodo (lo que devuelve core-process); `periodStart` y
    `periodEnd` son lo que de verdad cubre la consulta.
    """
    if granularidad not in ("week", "month"):
        raise ErrorDominio("granularity debe ser week o month.")
    salida, actual = [], inicio_de(desde, granularidad)
    while actual <= hasta:
        siguiente = actual + timedelta(days=7) if granularidad == "week" else _siguiente_mes(actual)
        salida.append({"periodStart": max(actual, desde).isoformat(),
                       "periodEnd": min(siguiente - timedelta(days=1), hasta).isoformat(),
                       "key": actual.isoformat()})
        actual = siguiente
    tope, nombre = (MAX_SEMANAS, "semanas") if granularidad == "week" else (MAX_MESES, "meses")
    if len(salida) > tope:
        raise ErrorDominio(f"El periodo abarca {len(salida)} {nombre}; el máximo es {tope}. Acota dateFrom y dateTo.")
    return salida


def semanas(desde: date, hasta: date) -> float:
    """Semanas del periodo (días / 7, inclusivo) para `basketsPerWeek`: octubre = 31 / 7."""
    return ((hasta - desde).days + 1) / 7


def versiones_en_periodo(historial: list[dict], segmento_id: int, desde: date | None, hasta: date | None) -> list[int]:
    """Versiones del segmento con que la zona estuvo clasificada en el periodo (BA-6, D-35).

    `historial`: `GET /v1/zones/:zoneId/classification/history` (`segmentId`, `segmentVersion`,
    `validFrom`, `validTo` nulo si sigue vigente). Sin fechas, todas las del segmento.
    """
    versiones = set()
    for c in historial:
        if c["segmentId"] != segmento_id:
            continue
        inicio = date.fromisoformat(c["validFrom"])
        fin = date.fromisoformat(c["validTo"]) if c.get("validTo") else None
        if hasta is not None and inicio > hasta:
            continue
        if desde is not None and fin is not None and fin < desde:
            continue
        versiones.add(c["segmentVersion"])
    return sorted(versiones)
