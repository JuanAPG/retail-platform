"""Lo que data-governance-service lee de los dueños de los datos, por HTTP (contrato: *Lo que consume*).

No lee tablas ajenas. Reenvía el `Authorization` del usuario y el `X-Correlation-Id`, con 3 s de
límite. A diferencia de los demás servicios, un dueño que no responde NO da 503: lanza `SinDueno`
con el motivo, y el reporte deja solo esa fuente o conjunto `disponible: false` (DG-7, DG-10).
"""
from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx
from fastapi import Request

from .correlacion import con_correlacion

TIMEOUT_S = 3.0
POR_PAGINA = 100
#: Tope de páginas por listado (lotes, o filas de UN lote): 5 000 elementos.
MAX_PAGINAS = 50
_ZONA = ZoneInfo("America/Monterrey")
_VARIABLES = {"transactions-ingestion-service": "INGESTION_SERVICE_URL",
              "core-process-service": "CORE_PROCESS_SERVICE_URL",
              "availability-service": "AVAILABILITY_SERVICE_URL",
              "income-segmentation-service": "INCOME_SEGMENTATION_SERVICE_URL"}


class SinDueno(Exception):
    """El dueño no respondió o no expone lo necesario: su fuente queda sin medir, con este motivo."""

    def __init__(self, motivo: str):
        super().__init__(motivo)
        self.motivo = motivo


def dia_local(instante: str) -> date:
    """Día en hora de Monterrey de un instante ISO 8601 (como filtran los demás servicios)."""
    return datetime.fromisoformat(instante.replace("Z", "+00:00")).astimezone(_ZONA).date()


class Fuentes:
    def __init__(self, autorizacion: str | None, cliente: httpx.Client):
        self._autorizacion = autorizacion
        self._cliente = cliente

    # --- transactions-ingestion-service: lotes (calidad de ventas-archivo)

    def lotes(self, desde: date | None, hasta: date | None) -> tuple[list[dict], date | None]:
        """(lotes de la ventana sin los descartados, día del último lote confirmado de todo el historial).

        ingestion no filtra por fecha: se recorre su listado (del más reciente al más viejo) y se filtra
        por `createdAt` aquí. El último confirmado se mide por su fecha de carga (no expone `confirmedAt`).
        """
        servicio = "transactions-ingestion-service"
        en_ventana, ultimo = [], None
        for lote in self._todas(servicio, "/v1/transaction-imports", {}):
            dia = dia_local(lote["createdAt"])
            if lote["state"] == "confirmado" and (ultimo is None or dia > ultimo):
                ultimo = dia
            if lote["state"] == "descartado" or (desde and dia < desde) or (hasta and dia > hasta):
                continue
            en_ventana.append(lote)
        return en_ventana, ultimo

    def rechazos(self, lotes: list[dict]) -> dict[str, int]:
        """Filas rechazadas por código, leyendo las filas SOLO de los lotes con rechazos.

        ingestion no expone `rejectedByCode` (pedido en el contrato). Si un lote tiene más de 5 000
        filas, `SinDueno`: completitud y fuera de rango quedan sin medir, nunca con un conteo a medias.
        """
        conteo: dict[str, int] = {}
        for lote in lotes:
            if not lote["counts"]["rejected"]:
                continue
            for fila in self._todas("transactions-ingestion-service", f"/v1/transaction-imports/{lote['id']}/rows", {},
                                    motivo_tope=f"el lote {lote['id']} tiene más de {MAX_PAGINAS * POR_PAGINA} filas "
                                                "y ingestion no expone rejectedByCode (pedido en el contrato)."):
                if fila["status"] == "rechazada":
                    codigo = fila.get("code") or "SIN_CODIGO"
                    conteo[codigo] = conteo.get(codigo, 0) + 1
        return conteo

    # --- availability-service: capturas y existencias (calidad de capturas-campo)

    def capturas(self) -> dict:
        """Totales por `limit=1`: capturas, en conflicto (D-42), existencias y vencidas (D-38)."""
        servicio = "availability-service"
        return {
            "capturas": self._total(servicio, "/v1/availability/captures", {}),
            "conflicto": self._total(servicio, "/v1/availability/captures", {"status": "conflicto"}),
            "existencias": self._total(servicio, "/v1/availability/stock", {}),
            "vencidas": self._total(servicio, "/v1/availability/stock", {"status": "vencido"}),
        }

    # --- income-segmentation-service: vigencia de los segmentos (frescura de inegi-enigh)

    def vigencias_segmentos(self) -> list[date]:
        return [dia_local(s["versionValidFrom"]) for s in self._todas("income-segmentation-service", "/v1/segments", {})
                if s.get("versionValidFrom")]

    # --- core-process-service: transacciones vencidas (evaluación de retención)

    def transacciones_hasta(self, corte: date) -> int:
        """`total` de `GET /v1/transactions?dateTo=corte` (día local, inclusivo): las vencidas (DG-9)."""
        return self._total("core-process-service", "/v1/transactions", {"dateTo": corte.isoformat()})

    # --- HTTP --------------------------------------------------------------

    def _total(self, servicio: str, ruta: str, params: dict) -> int:
        return self._get(servicio, ruta, {**params, "limit": 1})["total"]

    def _todas(self, servicio: str, ruta: str, params: dict, motivo_tope: str | None = None) -> Iterator[dict]:
        pagina = 1
        while True:
            datos = self._get(servicio, ruta, {**params, "page": pagina, "limit": POR_PAGINA})
            yield from datos["data"]
            if pagina * POR_PAGINA >= datos["total"]:
                return
            if pagina >= MAX_PAGINAS:
                raise SinDueno(motivo_tope or f"{servicio} tiene más de {MAX_PAGINAS * POR_PAGINA} registros que leer.")
            pagina += 1

    def _get(self, servicio: str, ruta: str, params: dict) -> dict:
        base = os.getenv(_VARIABLES[servicio])
        if not base:
            raise SinDueno(f"{servicio} no está configurado ({_VARIABLES[servicio]}).")
        encabezados = con_correlacion({"Authorization": self._autorizacion} if self._autorizacion else {})
        try:
            respuesta = self._cliente.get(f"{base}{ruta}", params=params, headers=encabezados)
        except httpx.TimeoutException:
            raise SinDueno(f"{servicio} no respondió en {TIMEOUT_S:g} s.") from None
        except httpx.HTTPError:
            raise SinDueno(f"No se pudo contactar a {servicio}.") from None
        if respuesta.status_code == 403:
            raise SinDueno(f"{servicio} no da lectura a este rol (pedido en el contrato).")
        if respuesta.status_code >= 400:
            raise SinDueno(f"{servicio} respondió {respuesta.status_code}.")
        return respuesta.json()


def obtener_fuentes(request: Request) -> Iterator[Fuentes]:
    """Dependencia de ruta: un cliente por petición, con el token del usuario."""
    with httpx.Client(timeout=TIMEOUT_S) as cliente:
        yield Fuentes(request.headers.get("authorization"), cliente)
