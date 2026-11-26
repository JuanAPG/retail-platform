"""BA-5: D-36, ningún agregado de un grupo con pocos datos.

El grupo zona-segmento se publica solo con al menos 10 transacciones (una canasta = una
transacción) y al menos 3 tiendas con venta en el periodo. P-11, decidido en este dominio: hacen
falta los dos (`PUBLICATION_RULE=ambos`); `cualquiera` publica si se cumple al menos uno.
Frontera: 10 transacciones en 2 tiendas → no disponible con `ambos`; 10 en 3 → disponible.
Un grupo sin canastas no es un 404: es `disponible: false` con su motivo.
"""
from __future__ import annotations

from .dominio import MIN_TIENDAS, MIN_TRANSACCIONES, REGLAS_PUBLICACION


def _plural(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


def evaluar(canastas: int, tiendas: int, regla: str) -> tuple[bool, str | None]:
    """(disponible, motivo). El motivo dice qué umbral faltó, con los conteos reales."""
    if regla not in REGLAS_PUBLICACION:
        raise ValueError(f"Regla de publicación desconocida: {regla!r}.")
    if canastas == 0:
        return False, "No hay canastas de la combinación zona-segmento en el periodo (D-36)."
    faltan_tx = canastas < MIN_TRANSACCIONES
    faltan_tiendas = tiendas < MIN_TIENDAS
    disponible = not (faltan_tx or faltan_tiendas) if regla == "ambos" else not (faltan_tx and faltan_tiendas)
    if disponible:
        return True, None

    tx = _plural(canastas, "transacción", "transacciones")
    ti = _plural(tiendas, "tienda", "tiendas")
    if faltan_tx and faltan_tiendas:
        detalle = f"{tx} (mínimo {MIN_TRANSACCIONES}) y {ti} (mínimo {MIN_TIENDAS})"
    elif faltan_tx:
        detalle = f"{tx} (mínimo {MIN_TRANSACCIONES}) en {ti}"
    else:
        detalle = f"{ti} (mínimo {MIN_TIENDAS}) con {_plural(canastas, 'canasta', 'canastas')}"
    return False, f"La combinación zona-segmento tiene {detalle} (D-36, regla {regla})."
