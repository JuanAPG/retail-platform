"""Semanas del pronóstico: ventana (DF-1), relleno con 0 (DF-3) y la huella de la serie (D-15).

DF-1: semana = lunes a domingo en America/Monterrey; `weekStart` es el lunes. La semana en
curso, incompleta, no entra: la última semana posible es la que terminó el domingo anterior a hoy.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .dominio import ZONA_HORARIA

_ZONA = ZoneInfo(ZONA_HORARIA)


def lunes_de(dia: date) -> date:
    return dia - timedelta(days=dia.weekday())


def ultimo_domingo_completo(ahora: datetime) -> date:
    """El domingo que cerró la última semana completa, en hora de Monterrey."""
    hoy = ahora.astimezone(_ZONA).date()
    return lunes_de(hoy) - timedelta(days=1)


def ventana(desde: date | None, hasta: date | None, ahora: datetime) -> tuple[date | None, date]:
    """Ajusta la ventana pedida a semanas completas.

    `desde` avanza al lunes siguiente si no es lunes; `hasta` retrocede al domingo anterior si no
    es domingo, y nunca pasa de la última semana completa. Devuelve (lunes o None, domingo).
    """
    tope = ultimo_domingo_completo(ahora)
    fin = tope if hasta is None else min(hasta - timedelta(days=(hasta.weekday() + 1) % 7), tope)
    inicio = None
    if desde is not None:
        inicio = desde if desde.weekday() == 0 else desde + timedelta(days=7 - desde.weekday())
    return inicio, fin


def serie_semanal(por_semana: dict[date, float], fin: date) -> list[dict]:
    """De la primera semana con venta a la semana que termina en `fin`, sin huecos (DF-3).

    Una semana sin ventas cuenta como 0 y sale con `filled: true`. Sin ventas → serie vacía.
    """
    con_venta = sorted(s for s, q in por_semana.items() if q > 0 and s <= fin)
    if not con_venta:
        return []
    serie, semana, ultima = [], con_venta[0], lunes_de(fin)
    while semana <= ultima:
        cantidad = por_semana.get(semana, 0.0)
        serie.append({"weekStart": semana.isoformat(), "quantity": float(cantidad), "filled": cantidad <= 0})
        semana += timedelta(days=7)
    return serie


def huella(serie: list[dict]) -> str:
    """SHA-256 de la serie exacta que usó la corrida (D-15): semana y cantidad, en orden."""
    foto = json.dumps([[s["weekStart"], s["quantity"]] for s in serie], separators=(",", ":"))
    return hashlib.sha256(foto.encode()).hexdigest()
