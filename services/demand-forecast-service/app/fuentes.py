"""Lo que demand-forecast-service lee de otros servicios, por HTTP (contrato: *Lo que consume*).

No lee tablas ajenas. Reenvía el `Authorization` del usuario (cada servicio valida su JWT + Redis
y aplica sus permisos) y el `X-Correlation-Id` de la operación. Si un servicio no responde en 3 s
o falla con 5xx → 503; un 404 de producto o zona → 404 con el id que faltó.
"""
from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import date

import httpx
from fastapi import HTTPException, Request

from .correlacion import con_correlacion

TIMEOUT_S = 3.0


class Fuentes:
    """Cliente de catalog-service y core-process-service para una petición (con su token)."""

    def __init__(self, autorizacion: str | None, cliente: httpx.Client):
        self._autorizacion = autorizacion
        self._cliente = cliente
        self._catalogo = os.getenv("CATALOG_SERVICE_URL", "http://catalog-service:3102")
        self._core = os.getenv("CORE_PROCESS_SERVICE_URL", "http://core-process-service:3104")

    def producto(self, producto_id: str) -> dict:
        datos = self._get("catalog-service", self._catalogo, f"/v1/products/{producto_id}",
                          no_existe=f"No existe el producto {producto_id}.")
        return {"id": datos["id"], "name": datos["nombre"]}

    def zona(self, zona_id: str) -> dict:
        datos = self._get("catalog-service", self._catalogo, f"/v1/zones/{zona_id}",
                          no_existe=f"No existe la zona {zona_id}.")
        return {"id": datos["id"], "name": datos["nombre"]}

    def presentaciones(self, producto_id: str) -> list[dict]:
        """`contenido` y `unidadMedida` (`tipo`, `factorBase`) de cada presentación (DF-2).

        Hoy catalog devuelve solo las activas; las ventas de una dada de baja salen en
        `excludedPresentations` (contrato: ajuste pedido a catalog-service).
        """
        return self._get("catalog-service", self._catalogo, f"/v1/products/{producto_id}/presentations",
                         no_existe=f"No existe el producto {producto_id}.")

    def ventas_semanales(self, producto_id: str, zona_id: str | None, desde: date | None, hasta: date) -> dict:
        """`GET /v1/analytics/weekly-sales`: semana × presentación, más la cobertura de D-36.

        Sin `asOf`: core-process usa "ahora" y lo devuelve; ese instante es la versión de los datos.
        """
        params = {"productId": producto_id, "dateTo": hasta.isoformat()}
        if zona_id:
            params["zoneId"] = zona_id
        if desde:
            params["dateFrom"] = desde.isoformat()
        return self._get("core-process-service", self._core, "/v1/analytics/weekly-sales", params)

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
