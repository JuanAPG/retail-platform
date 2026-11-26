"""Umbrales de D-37 y D-36 y el error de negocio que comparten los módulos del cálculo.

El cálculo (`publicacion`, `tipica`, `comparacion`, `periodos`) no sabe de HTTP: lanza
`ErrorDominio` con el status del contrato y la capa de rutas lo traduce al error estándar.
"""
from __future__ import annotations

import os

#: D-37: típico si aparece en al menos 1 de cada 5 canastas (20 %). Se compara con enteros (BA-3).
DIVISOR_TIPICO = 5
UMBRAL_TIPICO = 1 / DIVISOR_TIPICO

#: D-36 (BA-5).
MIN_TRANSACCIONES = 10
MIN_TIENDAS = 3
REGLAS_PUBLICACION = ("ambos", "cualquiera")

#: `basket-evolution`: tope de periodos por consulta.
MAX_SEMANAS = 104
MAX_MESES = 36

ZONA_HORARIA = "America/Monterrey"


class ErrorDominio(Exception):
    """Regla de negocio que impide responder: 400 por default (parámetros fuera de regla)."""

    def __init__(self, mensaje: str, status: int = 400):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.status = status


def regla_publicacion() -> str:
    """BA-5 / P-11: `PUBLICATION_RULE` (default `ambos`)."""
    valor = os.getenv("PUBLICATION_RULE", "ambos")
    if valor not in REGLAS_PUBLICACION:
        raise ValueError(f"PUBLICATION_RULE debe ser uno de {REGLAS_PUBLICACION}, no {valor!r}.")
    return valor
