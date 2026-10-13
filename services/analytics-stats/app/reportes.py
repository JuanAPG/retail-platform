"""STA-04: bitácora (audit-service) y aviso (notifications-service) de cada análisis.

Como el `AuditReporter`/`NotificationsReporter` de los servicios Nest: reenvía el
`Authorization` del usuario (audit y notifications sacan de ahí al actor), corta a
los 1.5 s y se traga cualquier error dejándolo en el log. Además corre como tarea
de fondo (`BackgroundTasks`): la respuesta del análisis sale antes, así que nunca
la cambia ni la retrasa.

- Corrida de clustering: bitácora + aviso `corrida.terminada` a quien la lanzó.
- Hipótesis, ANOVA, proporciones: solo bitácora. No se guardan, así que el aviso
  no tendría nada que abrir, y el resultado ya llegó en la respuesta.
"""
from __future__ import annotations

import ipaddress
import logging
import os

import httpx
from fastapi import Request

SERVICIO = "analytics-stats"
LIMITE_S = 1.5
_log = logging.getLogger(SERVICIO)

#: Cómo se nombra cada prueba en la bitácora.
NOMBRE_PRUEBA = {"hipotesis": "Prueba de hipótesis", "anova": "ANOVA", "proporciones": "Comparación de proporciones"}


def contexto(request: Request) -> tuple[str | None, str | None]:
    """El token del usuario y su IP. audit-service guarda la IP en una columna
    `INET`: si no es una IP válida, va `null` (si no, rechazaría el evento)."""
    ip = request.client.host if request.client else None
    try:
        ip = str(ipaddress.ip_address(ip)) if ip else None
    except ValueError:
        ip = None
    return request.headers.get("authorization"), ip


def _cliente() -> httpx.Client:
    return httpx.Client(timeout=LIMITE_S)


def _enviar(variable: str, ruta: str, cuerpo: dict, token: str | None, que: str) -> None:
    base = os.getenv(variable)
    if not base:
        return
    try:
        with _cliente() as http:
            respuesta = http.post(f"{base}{ruta}", json=cuerpo, headers={"Authorization": token} if token else {})
        if respuesta.status_code >= 400:
            # Un evento rechazado (p. ej. 400) no debe perderse en silencio.
            _log.warning("%s rechazada: HTTP %s", que, respuesta.status_code)
    except httpx.HTTPError as error:
        _log.warning("%s no reportada: %s", que, error)


def prueba_terminada(tipo: str, resultado: dict, token: str | None, ip: str | None) -> None:
    """Bitácora de una prueba estadística (`tipo`: hipotesis, anova o proporciones)."""
    decision = "rechaza H0" if resultado["rejectNull"] else "no rechaza H0"
    _enviar("AUDIT_SERVICE_URL", "/v1/auditoria", {
        "tabla": "analisis_estadistico",
        "registroId": None,
        "accion": "ejecutar_corrida",
        "servicio": SERVICIO,
        "descripcion": f"{NOMBRE_PRUEBA[tipo]} ({resultado['test']}): {resultado['conclusion']}"[:1000],
        "cambios": [
            {"campo": "tipo", "previo": None, "posterior": tipo},
            {"campo": "prueba", "previo": None, "posterior": resultado["test"]},
            {"campo": "resultado", "previo": None, "posterior": f"{decision} (p = {resultado['pValue']:.6g})"},
        ],
        "ip": ip,
    }, token, f"Auditoría de {tipo}")


def clustering_terminado(corrida: dict, token: str | None, ip: str | None) -> None:
    """Bitácora y aviso de una corrida de clustering ya guardada en Mongo."""
    grupos, zonas = corrida["parameters"]["k"], len(corrida["assignments"])
    resumen = f"{zonas} zona(s) en {grupos} grupos"
    if corrida["excludedZones"]:
        resumen += f"; {len(corrida['excludedZones'])} sin datos completos quedaron fuera"
    resumen += "."
    _enviar("AUDIT_SERVICE_URL", "/v1/auditoria", {
        "tabla": "analysis_runs",
        "registroId": corrida["id"],
        "accion": "ejecutar_corrida",
        "servicio": SERVICIO,
        "descripcion": f"Clustering completada: {resumen}",
        "cambios": [
            {"campo": "tipo", "previo": None, "posterior": "clustering"},
            {"campo": "estado", "previo": None, "posterior": "completada"},
        ],
        "ip": ip,
    }, token, "Auditoría de clustering")
    _enviar("NOTIFICATIONS_SERVICE_URL", "/v1/notifications", {
        "eventType": "corrida.terminada",
        "sourceService": SERVICIO,
        "relatedEntityType": "corrida",
        "relatedEntityId": corrida["id"],
        "recipientUserId": corrida["userId"],
        "title": "Clustering: corrida terminada",
        "message": resumen,
        "priority": "info",
    }, token, "Aviso de clustering")
