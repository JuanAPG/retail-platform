"""DF-8: D-36, ningún agregado con pocos datos.

Con menos de 10 transacciones con el producto o menos de 3 tiendas que lo vendieron (en la zona;
sin zona, en total), la corrida sale `disponible: false` con motivo y sin ningún número del
agregado. P-11, decidido en este dominio: se publica solo si se cumplen los dos umbrales
(`PUBLICATION_RULE=ambos`); `cualquiera` publica si se cumple al menos uno.
Frontera: 10 transacciones en 2 tiendas → no disponible con `ambos`; 10 en 3 → disponible.
"""
from __future__ import annotations

from .dominio import MIN_TIENDAS, MIN_TRANSACCIONES, REGLAS_PUBLICACION


def evaluar(transacciones: int, tiendas: int, regla: str, con_zona: bool) -> tuple[bool, str | None]:
    """(disponible, motivo). El motivo dice qué umbral faltó y dónde se contó."""
    if regla not in REGLAS_PUBLICACION:
        raise ValueError(f"Regla de publicación desconocida: {regla!r}.")
    faltan_tx = transacciones < MIN_TRANSACCIONES
    faltan_tiendas = tiendas < MIN_TIENDAS
    disponible = not (faltan_tx or faltan_tiendas) if regla == "ambos" else not (faltan_tx and faltan_tiendas)
    if disponible:
        return True, None
    donde = "en la zona" if con_zona else "en todas las zonas"
    partes = []
    if faltan_tx:
        partes.append(f"menos de {MIN_TRANSACCIONES} transacciones")
    if faltan_tiendas:
        partes.append(f"menos de {MIN_TIENDAS} tiendas")
    return False, f"{' y '.join(partes).capitalize()} con el producto {donde} (D-36)."
