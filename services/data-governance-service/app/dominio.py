"""Catálogos y umbrales del gobierno de datos (contrato `data-governance-service.md`) y el error de
negocio que comparten los módulos del cálculo (sin HTTP ni base de datos).
"""
from __future__ import annotations

import os
import re

#: Los 20 servicios de CONTRIBUTING.md ("Qué le toca a cada quien"): `ownerService` y `service`.
SERVICIOS = frozenset({
    "auth-service", "catalog-service", "pricing-service", "core-process-service", "algorithms-core",
    "analytics-stats", "decision-service", "documents-service", "notifications-service", "audit-service",
    "transactions-ingestion-service", "income-segmentation-service", "basket-analysis-service",
    "availability-service", "promotion-service", "demand-forecast-service", "recommendations-workflow-service",
    "offline-sync-service", "data-governance-service", "monitoring-service",
})

TIPOS_FUENTE = ("importacion", "operacion", "captura", "referencia_externa", "sintetico")
TIPOS_RECURSO = ("importacion", "version_segmento", "corrida")
CONJUNTOS = ("transacciones", "capturas_disponibilidad", "observaciones_precio", "visitas_campo", "notificaciones",
             "bitacora")

#: DG-1: minúsculas, números y guiones, de 3 a 40.
CLAVE_FUENTE = re.compile(r"^[a-z0-9-]{3,40}$")

#: DG-5: niveles del árbol de origen.
MAX_NIVELES_ORIGEN = 5
#: DG-11: registros por simulación.
MAX_REGISTROS_SIMULACION = 1000


class ErrorDominio(Exception):
    """Regla de negocio que impide la operación (400 por default, 409 en conflictos)."""

    def __init__(self, mensaje: str, status: int = 400):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.status = status


def dias_frescura_ventas() -> int:
    """DG-8: `FRESHNESS_SALES_DAYS` (7, el plazo de D-38)."""
    return _entero_positivo("FRESHNESS_SALES_DAYS", 7)


def dias_frescura_segmentos() -> int:
    """DG-8: `FRESHNESS_SEGMENTS_DAYS` (365: los segmentos declaran actualización anual)."""
    return _entero_positivo("FRESHNESS_SEGMENTS_DAYS", 365)


def _entero_positivo(variable: str, default: int) -> int:
    valor = int(os.getenv(variable, str(default)))
    if valor < 1:
        raise ValueError(f"{variable} debe ser al menos 1.")
    return valor
