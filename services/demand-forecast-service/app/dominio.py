"""Constantes de D-40 y el error de negocio que comparten los módulos del cálculo.

El cálculo (`semanas`, `unidades`, `modelo`, `publicacion`) no sabe de HTTP: lanza
`ErrorDominio` con el status del contrato y la capa de rutas lo traduce al error estándar.
"""
from __future__ import annotations

import os

#: D-40: lo fija la decisión, no se pide en la petición.
HORIZONTE_SEMANAS = 8
SEMANAS_RESERVADAS = 4
MIN_SEMANAS = 12
NIVELES_INTERVALO = (80, 95)
MODELO = "ETS(A,A,A)"

#: D-36 (DF-8).
MIN_TRANSACCIONES = 10
MIN_TIENDAS = 3
REGLAS_PUBLICACION = ("ambos", "cualquiera")

ZONA_HORARIA = "America/Monterrey"


class ErrorDominio(Exception):
    """Regla de negocio que impide el cálculo: 422 (o el status que diga el contrato)."""

    def __init__(self, mensaje: str, status: int = 422):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.status = status


def periodo_estacional() -> int:
    """DF-5: `SEASONAL_PERIOD` (default 4 semanas ≈ un mes)."""
    valor = int(os.getenv("SEASONAL_PERIOD", "4"))
    if valor < 2:
        raise ValueError("SEASONAL_PERIOD debe ser al menos 2.")
    return valor


def regla_publicacion() -> str:
    """DF-8 / P-11: `PUBLICATION_RULE` (default `ambos`)."""
    valor = os.getenv("PUBLICATION_RULE", "ambos")
    if valor not in REGLAS_PUBLICACION:
        raise ValueError(f"PUBLICATION_RULE debe ser uno de {REGLAS_PUBLICACION}, no {valor!r}.")
    return valor
