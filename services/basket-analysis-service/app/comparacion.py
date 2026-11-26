"""`typical-basket/compare`: la canasta típica del mismo grupo en dos periodos.

- `entering`: típicos en B y no en A; `leaving`: típicos en A y no en B; `staying`: en los dos.
  Orden BA-7 por `frequencyB` (y `productId`).
- `frequencyA`/`frequencyB` valen 0 si el producto no se vendió en ese periodo; su gasto
  promedio queda nulo (no hay gasto que promediar).
- `indicators`: `averageTicket`, `productsPerBasket` y `typicalSize`; `changePercent` nulo si A es 0.
"""
from __future__ import annotations


def comparar(productos_a: list[dict], productos_b: list[dict], resumen_a: dict, resumen_b: dict) -> dict:
    """`productos_*` con `incluir_todo=True` (hace falta la frecuencia de los no típicos)."""
    por_a = {p["productId"]: p for p in productos_a}
    por_b = {p["productId"]: p for p in productos_b}
    entran, salen, siguen = [], [], []
    for pid in set(por_a) | set(por_b):
        a, b = por_a.get(pid), por_b.get(pid)
        tipico_a, tipico_b = bool(a and a["typical"]), bool(b and b["typical"])
        if not (tipico_a or tipico_b):
            continue
        fila = {
            "productId": pid,
            "productName": (b or a)["productName"],
            "frequencyA": a["frequency"] if a else 0.0,
            "frequencyB": b["frequency"] if b else 0.0,
            "averageSpendA": a["averageSpend"] if a else None,
            "averageSpendB": b["averageSpend"] if b else None,
        }
        fila["frequencyChange"] = fila["frequencyB"] - fila["frequencyA"]
        (siguen if tipico_a and tipico_b else entran if tipico_b else salen).append(fila)
    for lista in (entran, salen, siguen):
        lista.sort(key=lambda f: (-f["frequencyB"], f["productId"]))

    tamano_a = sum(1 for p in productos_a if p["typical"])
    tamano_b = sum(1 for p in productos_b if p["typical"])
    return {
        "entering": entran,
        "leaving": salen,
        "staying": siguen,
        "indicators": [
            _cambio("averageTicket", resumen_a["averageTicket"], resumen_b["averageTicket"]),
            _cambio("productsPerBasket", resumen_a["productsPerBasket"], resumen_b["productsPerBasket"]),
            _cambio("typicalSize", tamano_a, tamano_b),
        ],
    }


def _cambio(indicador: str, a: float, b: float) -> dict:
    return {"indicator": indicador, "a": a, "b": b, "change": b - a,
            "changePercent": (b - a) / a * 100 if a else None}
