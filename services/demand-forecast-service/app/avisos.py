"""Bitácora (audit-service), aviso (notifications-service) y linaje (data-governance-service).

Contrato: *Bitácora, aviso y linaje*. Corren como tarea de fondo (`BackgroundTasks`) después de
responder, con límite de 1.5 s, reenviando el `Authorization` del usuario y el `X-Correlation-Id`.
Nunca cambian la respuesta: si fallan queda una línea de log con el id de la corrida para
reintentar. Sin la variable `*_SERVICE_URL` no se envía esa llamada. Un 4xx de la corrida no se
reporta (no se llega aquí).
"""
from __future__ import annotations

import ipaddress
import logging
import os
from dataclasses import dataclass

import httpx
from fastapi import Request

from .correlacion import CABECERA_CORRELACION, correlacion_actual

SERVICIO = "demand-forecast-service"
LIMITE_S = 1.5
FUENTE_VENTAS = "ventas-core-process"
_log = logging.getLogger(SERVICIO)


@dataclass(frozen=True)
class Contexto:
    """Lo que la tarea de fondo necesita de la petición: ya no corre dentro de ella."""
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


def _enviar(variable: str, ruta: str, cuerpo: dict, ctx: Contexto, que: str) -> None:
    base = os.getenv(variable)
    if not base:
        return
    encabezados = {}
    if ctx.token:
        encabezados["Authorization"] = ctx.token
    if ctx.correlacion:
        encabezados[CABECERA_CORRELACION] = ctx.correlacion
    try:
        with httpx.Client(timeout=LIMITE_S) as http:
            respuesta = http.post(f"{base}{ruta}", json=cuerpo, headers=encabezados)
        if respuesta.status_code >= 400:
            # Un evento rechazado no debe perderse en silencio.
            _log.warning("%s rechazado: HTTP %s", que, respuesta.status_code)
    except httpx.HTTPError as error:
        _log.warning("%s no enviado: %s", que, error)


def _donde(corrida: dict) -> str:
    return corrida["zone"]["name"] if corrida.get("zone") else "todas las zonas"


def corrida_guardada(corrida: dict, ctx: Contexto) -> None:
    """Bitácora y aviso de toda corrida guardada; linaje solo de las disponibles (tienen foto)."""
    producto, donde = corrida["product"]["name"], _donde(corrida)
    if corrida["disponible"]:
        mape = corrida["validation"]["mape"]
        resumen = (f"Pronóstico de {producto} en {donde}: {corrida['dataVersion']['weeks']} semanas, "
                   f"MAPE {'no calculable' if mape is None else f'{mape:.2f} %'}.")
    else:
        resumen = f"Pronóstico de {producto} en {donde}: no disponible. {corrida['motivo']}"
        mape = None
    que = f"corrida {corrida['id']}"
    _enviar("AUDIT_SERVICE_URL", "/v1/auditoria", {
        "tabla": "forecast_runs",
        "registroId": corrida["id"],
        "accion": "ejecutar_corrida",
        "servicio": SERVICIO,
        "descripcion": resumen[:1000],
        "cambios": [
            {"campo": "tipo", "previo": None, "posterior": "pronostico"},
            {"campo": "disponible", "previo": None, "posterior": str(corrida["disponible"]).lower()},
            {"campo": "mape", "previo": None, "posterior": None if mape is None else f"{mape:.6g}"},
        ],
        "ip": ctx.ip,
    }, ctx, f"Auditoría de la {que}")
    _enviar("NOTIFICATIONS_SERVICE_URL", "/v1/notifications", {
        "eventType": "corrida.terminada",
        "sourceService": SERVICIO,
        "relatedEntityType": "corrida",
        "relatedEntityId": corrida["id"],
        "recipientUserId": corrida["userId"],
        "title": "Pronóstico de demanda: corrida terminada",
        "message": resumen[:500],
        "priority": "info",
    }, ctx, f"Aviso de la {que}")
    if corrida["disponible"]:
        _enviar("DATA_GOVERNANCE_SERVICE_URL", "/v1/lineage", {
            "service": SERVICIO,
            "resourceType": "corrida",
            "resourceId": corrida["id"],
            "description": f"Pronóstico semanal de {producto} en {donde}"[:300],
            "source": {"key": FUENTE_VENTAS, "version": corrida["dataVersion"]["sha256"]},
            "occurredAt": corrida["date"],
        }, ctx, f"Linaje de la {que}")


def repeticion(resultado: dict, ctx: Contexto) -> None:
    """Bitácora del `replay` (no crea corrida nueva: no hay aviso ni linaje)."""
    _enviar("AUDIT_SERVICE_URL", "/v1/auditoria", {
        "tabla": "forecast_runs",
        "registroId": resultado["runId"],
        "accion": "ejecutar_corrida",
        "servicio": SERVICIO,
        "descripcion": ("Repetición de la corrida: resultado idéntico." if resultado["identical"]
                        else f"Repetición de la corrida: {len(resultado['differences'])} diferencia(s)."),
        "cambios": [
            {"campo": "tipo", "previo": None, "posterior": "repeticion"},
            {"campo": "identical", "previo": None, "posterior": str(resultado["identical"]).lower()},
        ],
        "ip": ctx.ip,
    }, ctx, f"Auditoría de la repetición de {resultado['runId']}")
