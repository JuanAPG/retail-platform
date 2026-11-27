"""DF-2: la serie es por producto, en la unidad base de su tipo (D-06: no se mezclan presentaciones).

`cantidad × contenido × factorBase` de la presentación vendida → kg, l o pza. Así 3 de "500 ml" y
1 de "1 l" en la misma semana suman 2.5 l. Si las presentaciones vendidas son de tipos distintos
(p. ej. pieza y masa) no se pueden sumar → 422. Una venta de una presentación que el catálogo no
devuelve (dada de baja, sin contenido conocido) no se convierte: sale en `excludedPresentations`.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from .dominio import ErrorDominio

#: Tipo de `unidades_medida` → unidad base (factor_base = 1).
UNIDAD_BASE = {"masa": "kg", "volumen": "l", "pieza": "pza"}

#: Decimales al convertir: quita el ruido binario (0.1 + 0.2) sin perder nada de un NUMERIC(10,2).
_DECIMALES = 6


def _factor(presentacion: dict) -> Decimal:
    unidad = presentacion["unidadMedida"]
    return Decimal(str(presentacion["contenido"])) * Decimal(str(unidad["factorBase"]))


def convertir(filas: list[dict], presentaciones: list[dict]) -> dict:
    """Suma por semana las ventas de `weekly-sales` en la unidad base del producto.

    `filas`: `{weekStart, presentationId, quantity}` de core-process.
    `presentaciones`: las del producto en catalog-service (`contenido`, `unidadMedida`).
    Devuelve `{porSemana: {date: float}, unit, unitType, excluded: [...]}`.
    """
    catalogo = {p["id"]: p for p in presentaciones}
    vendidas = {f["presentationId"] for f in filas}
    tipos = {catalogo[pid]["unidadMedida"]["tipo"] for pid in vendidas if pid in catalogo}
    if len(tipos) > 1:
        raise ErrorDominio(
            "Las presentaciones vendidas del producto son de tipos de unidad distintos "
            f"({', '.join(sorted(tipos))}): no se pueden sumar en una sola serie (DF-2, D-06).")
    if tipos:
        tipo = tipos.pop()
    else:
        # Sin ventas convertibles: el tipo sale del catálogo, para que la respuesta diga la unidad.
        tipos_catalogo = {p["unidadMedida"]["tipo"] for p in presentaciones}
        tipo = tipos_catalogo.pop() if len(tipos_catalogo) == 1 else None
    if tipo is not None and tipo not in UNIDAD_BASE:
        raise ErrorDominio(f"Tipo de unidad desconocido: {tipo}.")
    unidad = UNIDAD_BASE.get(tipo) if tipo else None

    por_semana: dict[date, Decimal] = {}
    excluidas: dict[str, str] = {}
    for fila in filas:
        presentacion = catalogo.get(fila["presentationId"])
        if presentacion is None:
            excluidas[fila["presentationId"]] = (
                f"Presentación inactiva sin contenido conocido: sus ventas no se convierten a {unidad or 'la unidad base'}.")
            continue
        semana = date.fromisoformat(fila["weekStart"])
        por_semana[semana] = por_semana.get(semana, Decimal(0)) + Decimal(str(fila["quantity"])) * _factor(presentacion)

    return {
        "porSemana": {s: float(round(q, _DECIMALES)) for s, q in por_semana.items()},
        "unit": unidad,
        "unitType": tipo,
        "excluded": [{"presentationId": pid, "reason": motivo} for pid, motivo in sorted(excluidas.items())],
    }
