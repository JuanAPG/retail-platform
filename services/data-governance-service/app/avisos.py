"""Bitácora en audit-service (contrato: *Bitácora y avisos*): alta y cambio de fuente, alta de versión.

Corre como tarea de fondo después de responder, con límite de 1.5 s, reenviando el `Authorization`
y el `X-Correlation-Id`. Nunca cambia la respuesta: si falla queda una línea de log. El registro de
linaje no se audita (ya es en sí un registro inmutable con quién, cuándo y correlación) y no hay
notificaciones: ninguna decisión define un aviso para estos eventos.
"""
from __future__ import annotations

import ipaddress
import logging
import os
from dataclasses import dataclass

import httpx
from fastapi import Request

from .correlacion import CABECERA_CORRELACION, correlacion_actual

SERVICIO = "data-governance-service"
LIMITE_S = 1.5
_log = logging.getLogger(SERVICIO)


@dataclass(frozen=True)
class Contexto:
    token: str | None
    ip: str | None
    correlacion: str | None


def contexto(request: Request) -> Contexto:
    """audit-service guarda la IP en una columna `INET`: si no es una IP válida va `null`."""
    ip = request.client.host if request.client else None
    try:
        ip = str(ipaddress.ip_address(ip)) if ip else None
    except ValueError:
        ip = None
    return Contexto(request.headers.get("authorization"), ip, correlacion_actual())


def _auditar(cuerpo: dict, ctx: Contexto, que: str) -> None:
    base = os.getenv("AUDIT_SERVICE_URL")
    if not base:
        return
    encabezados = {k: v for k, v in (("Authorization", ctx.token), (CABECERA_CORRELACION, ctx.correlacion)) if v}
    try:
        with httpx.Client(timeout=LIMITE_S) as http:
            respuesta = http.post(f"{base}/v1/auditoria", json={**cuerpo, "servicio": SERVICIO, "ip": ctx.ip},
                                  headers=encabezados)
        if respuesta.status_code >= 400:
            _log.warning("Auditoría de %s rechazada: HTTP %s", que, respuesta.status_code)
    except httpx.HTTPError as error:
        _log.warning("Auditoría de %s no enviada: %s", que, error)


def _texto(valor) -> str | None:
    return None if valor is None else str(valor).lower() if isinstance(valor, bool) else str(valor)


def fuente_creada(fuente: dict, ctx: Contexto) -> None:
    _auditar({"tabla": "fuentes_datos", "registroId": fuente["key"], "accion": "insert",
              "descripcion": f"Alta de la fuente {fuente['key']} ({fuente['name']}).",
              "cambios": [{"campo": c, "previo": None, "posterior": _texto(fuente[c])}
                          for c in ("name", "type", "ownerService", "description") if fuente[c] is not None]},
             ctx, f"la fuente {fuente['key']}")


def fuente_cambiada(antes: dict, despues: dict, ctx: Contexto) -> None:
    cambios = [{"campo": c, "previo": _texto(antes[c]), "posterior": _texto(despues[c])}
               for c in ("name", "description", "ownerService", "active") if antes[c] != despues[c]]
    if not cambios:
        return
    _auditar({"tabla": "fuentes_datos", "registroId": despues["key"], "accion": "update",
              "descripcion": f"Cambio de la fuente {despues['key']}.", "cambios": cambios},
             ctx, f"el cambio de {despues['key']}")


def version_creada(version: dict, ctx: Contexto) -> None:
    _auditar({"tabla": "fuente_versiones", "registroId": f"{version['sourceKey']}:{version['version']}",
              "accion": "insert", "descripcion": f"Versión {version['version']} de la fuente {version['sourceKey']}.",
              "cambios": [{"campo": "version", "previo": None, "posterior": version["version"]}]},
             ctx, f"la versión {version['version']}")
