"""Canasta típica de un grupo (D-37): BA-2, BA-3, BA-4 y BA-7.

Entrada: un periodo de `GET /v1/analytics/basket-products` de core-process (`baskets`, `stores`,
`totalSpend`) y sus filas por producto (`basketsWithProduct` ya cuenta canastas distintas, así que
un producto cuenta una vez por canasta aunque lleve varias presentaciones, BA-2).

- Típico si `basketsWithProduct × 5 ≥ baskets` (BA-3): enteros, sin redondeo. 20 de 100 entra,
  19 de 100 no; 3 de 12 entra, 2 de 12 no.
- Frecuencia = basketsWithProduct / baskets; gasto promedio = spend / basketsWithProduct (BA-4).
- Orden: frecuencia descendente y, a igual frecuencia, `productId` (BA-7).
"""
from __future__ import annotations

import hashlib
import json

from .dominio import DIVISOR_TIPICO

SIN_CATEGORIA = "Sin categoría"


def es_tipico(con_producto: int, canastas: int) -> bool:
    return canastas > 0 and con_producto * DIVISOR_TIPICO >= canastas


def productos(periodo: dict, filas: list[dict], categorias: dict[int, str], incluir_todo: bool) -> list[dict]:
    """Productos del grupo con su frecuencia y gasto; sin `incluir_todo`, solo los típicos."""
    canastas = periodo["baskets"]
    salida = []
    for fila in sorted(filas, key=lambda f: (-f["basketsWithProduct"], f["productId"])):
        k = fila["basketsWithProduct"]
        tipico = es_tipico(k, canastas)
        if not (tipico or incluir_todo):
            continue
        categoria = fila.get("categoryId")
        salida.append({
            "productId": fila["productId"],
            "productName": fila["productName"],
            "categoryId": categoria,
            "categoryName": categorias.get(categoria, SIN_CATEGORIA) if categoria is not None else SIN_CATEGORIA,
            "basketsWithProduct": k,
            "frequency": k / canastas,
            "averageSpend": round(float(fila["spend"]) / k, 2),
            "typical": tipico,
        })
    return salida


def resumen(periodo: dict, filas: list[dict], semanas: float) -> dict:
    """Ticket, productos distintos por canasta y canastas por semana del grupo (agregado, nunca por cliente)."""
    canastas = periodo["baskets"]
    distintos = sum(f["basketsWithProduct"] for f in filas)  # BA-2: cada producto, una vez por canasta
    gasto = float(periodo["totalSpend"])
    return {
        "baskets": canastas,
        "totalSpend": round(gasto, 2),
        "averageTicket": round(gasto / canastas, 2),
        "productsPerBasket": round(distintos / canastas, 2),
        "basketsPerWeek": canastas / semanas,
    }


def tamano_tipico(periodo: dict, filas: list[dict]) -> int:
    return sum(1 for f in filas if es_tipico(f["basketsWithProduct"], periodo["baskets"]))


def huella(periodos: list[dict], filas: list[dict]) -> str:
    """SHA-256 de los datos usados (D-15): mismo `asOf`, misma huella. No depende del orden de llegada."""
    datos = {
        "periods": sorted(([p.get("periodStart"), p["baskets"], p["stores"], float(p["totalSpend"])] for p in periodos),
                          key=lambda x: (x[0] or "")),
        "data": sorted([f.get("periodStart") or "", f["productId"], f["basketsWithProduct"], float(f["spend"])]
                       for f in filas),
    }
    return hashlib.sha256(json.dumps(datos, separators=(",", ":")).encode()).hexdigest()
