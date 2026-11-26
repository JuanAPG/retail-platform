"""Retención de D-43: vencimiento (DG-9), corte de la evaluación (DG-10) y simulación (DG-11).

DG-9: `expiresOn = fecha del dato + plazo`, en calendario (un 29 de febrero más años cae el 1 de
marzo). Un dato está vencido si `expiresOn ≤ asOf`: vence el mismo día en que se cumple el plazo.
La bitácora (plazo nulo) no vence nunca.
"""
from __future__ import annotations

import calendar
import re
from datetime import date, timedelta

from .dominio import CONJUNTOS, MAX_REGISTROS_SIMULACION, ErrorDominio

_PLAZO = re.compile(r"^P(\d+)([YMD])$")


def _sumar_meses(dia: date, meses: int) -> date:
    """Mes calendario; si el día no existe en el mes destino, pasa al primero del siguiente.

    Así 2024-02-29 + 3 años = 2027-03-01 (contrato), no 2027-02-28.
    """
    total = dia.month - 1 + meses
    anio, mes = dia.year + total // 12, total % 12 + 1
    if dia.day <= calendar.monthrange(anio, mes)[1]:
        return date(anio, mes, dia.day)
    return date(anio, mes, calendar.monthrange(anio, mes)[1]) + timedelta(days=1)


def _restar_meses(dia: date, meses: int) -> date:
    """Inverso para el corte: el último día cuyo vencimiento ya llegó a `asOf`."""
    total = dia.month - 1 - meses
    anio, mes = dia.year + total // 12, total % 12 + 1
    return date(anio, mes, min(dia.day, calendar.monthrange(anio, mes)[1]))


def sumar_plazo(dia: date, plazo: str) -> date:
    n, unidad = _partes(plazo)
    if unidad == "D":
        return dia + timedelta(days=n)
    return _sumar_meses(dia, n * 12 if unidad == "Y" else n)


def vence(dia: date, plazo: str | None) -> date | None:
    """`expiresOn` (DG-9). Plazo nulo (bitácora) → nunca."""
    return None if plazo is None else sumar_plazo(dia, plazo)


def vencido(dia: date, plazo: str | None, as_of: date) -> bool:
    fin = vence(dia, plazo)
    return fin is not None and fin <= as_of


def fecha_de_corte(as_of: date, plazo: str | None) -> date | None:
    """DG-10: `cutoffDate = asOf − plazo`. Vencen los datos con fecha ≤ corte.

    Con el CSV de 100 canastas y `asOf = 2029-09-01`: corte 2026-09-01, así que las ventas del
    1 de septiembre de 2026 ya cuentan (vencen ese mismo día).
    """
    if plazo is None:
        return None
    n, unidad = _partes(plazo)
    if unidad == "D":
        return as_of - timedelta(days=n)
    return _restar_meses(as_of, n * 12 if unidad == "Y" else n)


def simular(as_of: date, registros: list[dict], plazos: dict[str, str | None]) -> dict:
    """DG-11: aplica DG-9 a registros sintéticos. No lee ni escribe nada.

    `registros`: `[{dataset, recordId, date}]`; `plazos`: conjunto → plazo (de politicas_retencion).
    """
    if not 1 <= len(registros) <= MAX_REGISTROS_SIMULACION:
        raise ErrorDominio(f"records debe traer de 1 a {MAX_REGISTROS_SIMULACION} registros.")
    datos, resumen = [], {}
    for r in registros:
        if r["dataset"] not in plazos:
            raise ErrorDominio(f"dataset desconocido: {r['dataset']}. Debe ser uno de {', '.join(CONJUNTOS)}.")
        dia = r["date"] if isinstance(r["date"], date) else date.fromisoformat(r["date"])
        fin = vence(dia, plazos[r["dataset"]])
        esta_vencido = fin is not None and fin <= as_of
        datos.append({"dataset": r["dataset"], "recordId": r["recordId"], "date": dia.isoformat(),
                      "expiresOn": fin.isoformat() if fin else None, "expired": esta_vencido})
        cuenta = resumen.setdefault(r["dataset"], {"dataset": r["dataset"], "total": 0, "expired": 0})
        cuenta["total"] += 1
        cuenta["expired"] += esta_vencido
    return {"asOf": as_of.isoformat(), "data": datos, "summary": list(resumen.values())}


def _partes(plazo: str) -> tuple[int, str]:
    m = _PLAZO.match(plazo)
    if not m:
        raise ValueError(f"Plazo ISO 8601 no soportado: {plazo!r}.")
    return int(m.group(1)), m.group(2)
