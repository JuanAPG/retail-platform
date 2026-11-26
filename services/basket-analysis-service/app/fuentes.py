"""Lo que basket-analysis-service lee de otros servicios, por HTTP (contrato: *Lo que consume*).

No lee tablas ajenas ni guarda nada. Reenvía el `Authorization` del usuario (cada servicio valida
su JWT + Redis y aplica sus permisos) y el `X-Correlation-Id` de la operación. Si un servicio no
responde en 3 s o falla con 5xx → 503; zona o segmento inexistente → 404 con el id que faltó.
"""
from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import date

import httpx
from fastapi import HTTPException, Request

from .correlacion import con_correlacion

TIMEOUT_S = 3.0
POR_PAGINA = 100


class Fuentes:
    """Cliente de core-process, catalog e income-segmentation para una petición (con su token)."""

    def __init__(self, autorizacion: str | None, cliente: httpx.Client):
        self._autorizacion = autorizacion
        self._cliente = cliente
        self._core = os.getenv("CORE_PROCESS_SERVICE_URL", "http://core-process-service:3104")
        self._catalogo = os.getenv("CATALOG_SERVICE_URL", "http://catalog-service:3102")
        self._segmentacion = os.getenv("INCOME_SEGMENTATION_SERVICE_URL", "http://income-segmentation-service:3112")

    # --- catalog-service

    def zona(self, zona_id: str) -> dict:
        datos = self._get("catalog-service", self._catalogo, f"/v1/zones/{zona_id}",
                          no_existe=f"No existe la zona {zona_id}.")
        return {"id": datos["id"], "name": datos["nombre"]}

    def categorias(self) -> dict[int, str]:
        """Nombre de cada categoría de producto (basket-products solo trae el id)."""
        filas = self._get("catalog-service", self._catalogo, "/v1/product-categories")
        return {c["id"]: c["nombre"] for c in filas}

    # --- income-segmentation-service

    def segmento(self, segmento_id: int) -> dict:
        datos = self._get("income-segmentation-service", self._segmentacion, f"/v1/segments/{segmento_id}",
                          no_existe=f"No existe el segmento {segmento_id}.")
        return {"id": datos["id"], "code": datos["code"], "name": datos["name"]}

    def historial(self, zona_id: str) -> list[dict]:
        """Clasificaciones de la zona con su versión de segmento (BA-6, D-35), todas las páginas."""
        filas, pagina = [], 1
        while True:
            datos = self._get("income-segmentation-service", self._segmentacion,
                              f"/v1/zones/{zona_id}/classification/history",
                              {"page": pagina, "limit": POR_PAGINA})
            filas += datos["data"]
            if pagina * POR_PAGINA >= datos["total"]:
                return filas
            pagina += 1

    # --- core-process-service

    def canastas_por_producto(self, zona_id: str, segmento_id: int, desde: date | None, hasta: date | None,
                              as_of: str | None = None, agrupar: str | None = None) -> dict:
        """`GET /v1/analytics/basket-products`: canastas, tiendas y gasto por periodo, y por producto
        en cuántas canastas distintas aparece (BA-2). Sin `asOf`, core-process usa "ahora" y lo devuelve.
        """
        return self._get("core-process-service", self._core, "/v1/analytics/basket-products",
                         _sin_nulos(zoneId=zona_id, segmentId=segmento_id, dateFrom=desde, dateTo=hasta,
                                    asOf=as_of, groupBy=agrupar))

    def gasto_por_categoria(self, zona_id: str, segmento_id: int, desde: date | None, hasta: date | None) -> list[dict]:
        """`GET /v1/analytics/spend-by-category` (existe; no acepta `asOf`)."""
        return self._get("core-process-service", self._core, "/v1/analytics/spend-by-category",
                         _sin_nulos(zoneId=zona_id, segmentId=segmento_id, dateFrom=desde, dateTo=hasta))

    # --- HTTP --------------------------------------------------------------

    def _get(self, servicio: str, base: str, ruta: str, params: dict | None = None,
             no_existe: str | None = None):
        encabezados = con_correlacion({"Authorization": self._autorizacion} if self._autorizacion else {})
        try:
            respuesta = self._cliente.get(f"{base}{ruta}", params=params, headers=encabezados)
        except httpx.TimeoutException as error:
            raise HTTPException(503, f"{servicio} no respondió en {TIMEOUT_S:g} s.") from error
        except httpx.HTTPError as error:
            raise HTTPException(503, f"No se pudo contactar a {servicio}.") from error
        if respuesta.status_code >= 500:
            raise HTTPException(503, f"{servicio} no está disponible (respondió {respuesta.status_code}).")
        if respuesta.status_code == 404 and no_existe:
            raise HTTPException(404, no_existe)
        if respuesta.status_code >= 400:
            # 401/403 de otro servicio (sesión cerrada, rol sin permiso allá) se propagan tal cual.
            raise HTTPException(respuesta.status_code, _mensaje(respuesta) or f"{servicio} rechazó la consulta.")
        return respuesta.json()


def _sin_nulos(**params) -> dict:
    """Los filtros que no vienen no se mandan (un `dateFrom=None` sería un 400 en core-process)."""
    return {k: (v.isoformat() if isinstance(v, date) else v) for k, v in params.items() if v is not None}


def _mensaje(respuesta: httpx.Response) -> str | None:
    try:
        mensaje = respuesta.json().get("message")
    except (ValueError, AttributeError):
        return None
    return mensaje if isinstance(mensaje, str) else None


def obtener_fuentes(request: Request) -> Iterator[Fuentes]:
    """Dependencia de ruta: un cliente por petición, con el token del usuario."""
    with httpx.Client(timeout=TIMEOUT_S) as cliente:
        yield Fuentes(request.headers.get("authorization"), cliente)
