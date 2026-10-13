"""Lo que analytics-stats lee de otros servicios, por HTTP (contrato: *Lo que
consume analytics-stats*). No lee tablas ajenas.

Reenvía el `Authorization` del usuario: cada servicio valida su JWT + Redis y
aplica sus permisos. Si un servicio no responde en 3 s (o falla con 5xx) → 503.
"""
from __future__ import annotations

import math
import os
from collections.abc import Iterator

import httpx
from fastapi import HTTPException, Request

from .estadistica import Conteo, DatosInvalidos, Grupo

TIMEOUT_S = 3.0
POR_PAGINA = 100
#: D-27 (b): máximo de páginas de `GET /v1/baskets` por prueba.
MAX_PAGINAS = 500

#: Qué se compara, para la conclusión ("hay diferencia en el ticket entre…").
QUE_METRICA = {
    "totalValue": "el ticket",
    "productCount": "los productos por canasta",
    "unitsTotal": "las unidades por canasta",
}
QUE_CONDICION = {
    "hasBasicProducts": "de canastas con productos básicos",
    "chica": "de canastas chicas",
    "mediana": "de canastas medianas",
    "grande": "de canastas grandes",
}


class Fuentes:
    """Cliente de core-process y catalog para una petición (con su token)."""

    def __init__(self, autorizacion: str | None, cliente: httpx.Client):
        self._autorizacion = autorizacion
        self._cliente = cliente
        self._core = os.getenv("CORE_PROCESS_SERVICE_URL", "http://core-process-service:3104")
        self._catalogo = os.getenv("CATALOG_SERVICE_URL", "http://catalog-service:3102")

    # --- Modo `baskets` --------------------------------------------------

    def valores(self, fuente) -> list[Grupo]:
        """Un valor de `fuente.metric` por canasta, por grupo (RN-03).

        Lee la primera página de cada grupo y, si en total harían falta más de
        `MAX_PAGINAS`, responde 400 sin leer el resto: cortar dejaría solo las
        canastas más recientes y el resultado se vería válido sin serlo.
        """
        nombres = [self.nombre_de_grupo(fuente.groupBy, gid) for gid in fuente.groupIds]
        primeras = [self._canastas(fuente, gid, 1, POR_PAGINA) for gid in fuente.groupIds]

        paginas = sum(math.ceil(p["total"] / POR_PAGINA) for p in primeras)
        if paginas > MAX_PAGINAS:
            canastas = sum(p["total"] for p in primeras)
            raise DatosInvalidos(
                f"Hay {canastas} canastas para esta prueba ({paginas} páginas); el máximo es {MAX_PAGINAS} "
                f"páginas ({MAX_PAGINAS * POR_PAGINA} canastas, D-27). Acota con dateFrom, dateTo o storeId.")

        grupos = []
        for gid, nombre, primera in zip(fuente.groupIds, nombres, primeras):
            filas = list(primera["data"])
            for pagina in range(2, math.ceil(primera["total"] / POR_PAGINA) + 1):
                filas += self._canastas(fuente, gid, pagina, POR_PAGINA)["data"]
            # `totalValue` y `unitsTotal` llegan como texto ("170.50"): numeric de Postgres.
            grupos.append(Grupo(nombre, [float(fila[fuente.metric]) for fila in filas]))
        return grupos

    def conteos(self, fuente) -> list[Conteo]:
        """Por grupo: cuántas canastas cumplen `fuente.condition` y cuántas hay.

        Solo se leen los `total` (`limit=1`): dos peticiones por grupo.
        """
        if fuente.condition == "hasBasicProducts":
            condicion = {"hasBasicProducts": "true"}
        else:
            condicion = {"size": fuente.condition}
        conteos = []
        for gid in fuente.groupIds:
            nombre = self.nombre_de_grupo(fuente.groupBy, gid)
            total = self._canastas(fuente, gid, 1, 1)["total"]
            exitos = self._canastas(fuente, gid, 1, 1, condicion)["total"]
            conteos.append(Conteo(nombre, exitos, total))
        return conteos

    # --- Clustering ---------------------------------------------------------

    def zonas(self, zone_ids: list[str] | None) -> list[dict]:
        """Zonas a agrupar con sus indicadores de catalog (`GET /v1/zones/compare`).

        Sin `zone_ids`, todas las zonas activas de `GET /v1/zones`.
        """
        if zone_ids is None:
            zone_ids, pagina = [], 1
            while True:
                datos = self._get("catalog-service", self._catalogo, "/v1/zones",
                                  {"page": pagina, "limit": POR_PAGINA})
                zone_ids += [z["id"] for z in datos["data"] if z.get("activo", True)]
                if pagina * POR_PAGINA >= datos["total"]:
                    break
                pagina += 1
        if len(zone_ids) < 3:
            # `compare` pide al menos 2 ids, y agrupar pide al menos 3 zonas.
            raise DatosInvalidos(f"Se necesitan al menos 3 zonas para agrupar; hay {len(zone_ids)}.")
        filas = self._get("catalog-service", self._catalogo, "/v1/zones/compare", {"ids": ",".join(zone_ids)})
        return [{"zoneId": f["zoneId"], "zoneName": f["zoneName"], "estimatedIncome": f["estimatedIncome"],
                 "population": f["population"], "availability": f["availability"]} for f in filas]

    def ticket_promedio(self, zone_id: str, date_from: str | None, date_to: str | None) -> float | None:
        params = {"zoneId": zone_id}
        if date_from:
            params["dateFrom"] = date_from
        if date_to:
            params["dateTo"] = date_to
        valor = self._get("core-process-service", self._core, "/v1/analytics/average-ticket", params)
        # core-process responde 0 cuando la zona no tiene canastas en el periodo. Un
        # ticket real nunca es 0, así que es un dato faltante, no un valor (D-20).
        return float(valor) if valor else None

    def nombre_de_grupo(self, group_by: str, gid: str) -> str:
        if group_by == "segment":
            return self._get("catalog-service", self._catalogo, f"/v1/segments/{gid}",
                             no_existe=f"No existe el segmento {gid}.")["name"]
        return self._get("catalog-service", self._catalogo, f"/v1/zones/{gid}",
                         no_existe=f"No existe la zona {gid}.")["nombre"]

    def _canastas(self, fuente, gid: str, pagina: int, limite: int, extra: dict | None = None) -> dict:
        params = {"segmentId" if fuente.groupBy == "segment" else "zoneId": gid, "page": pagina, "limit": limite}
        for campo in ("dateFrom", "dateTo", "storeId"):
            valor = getattr(fuente, campo)
            if valor is not None:
                params[campo] = str(valor)
        return self._get("core-process-service", self._core, "/v1/baskets", {**params, **(extra or {})})

    # --- HTTP --------------------------------------------------------------

    def _get(self, servicio: str, base: str, ruta: str, params: dict | None = None,
             no_existe: str | None = None) -> dict:
        encabezados = {"Authorization": self._autorizacion} if self._autorizacion else {}
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
            raise HTTPException(respuesta.status_code, _mensaje(respuesta) or f"{servicio} rechazó la consulta.")
        return respuesta.json()


def _mensaje(respuesta: httpx.Response) -> str | None:
    try:
        mensaje = respuesta.json().get("message")
    except ValueError:
        return None
    return mensaje if isinstance(mensaje, str) else None


def obtener_fuentes(request: Request) -> Iterator[Fuentes]:
    """Dependencia de ruta: un cliente por petición, con el token del usuario."""
    with httpx.Client(timeout=TIMEOUT_S) as cliente:
        yield Fuentes(request.headers.get("authorization"), cliente)
