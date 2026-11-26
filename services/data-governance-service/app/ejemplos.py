"""Ejemplos de Swagger en JSON y XML (los de `docs/contratos/ejemplos/data-governance-*`, recortados).

El XML se arma con el mismo serializador que usa el servicio, así que el ejemplo y la respuesta
real tienen la misma forma.
"""
from __future__ import annotations

from .xml_out import namespace_xml, serializar_xml

_USUARIO = "5b1e7d3c-2a4f-4e6b-8c9d-0e1f2a3b4c5d"
_SHA = "be303c96b5d5e8779e0b1523319e456ef247713341192eedbc6af536c56876ad"
_CUANDO = "2026-11-26T09:00:00.000000+00:00"

FUENTE = {"key": "inegi-enigh", "name": "INEGI ENIGH: ingreso corriente trimestral por hogar",
          "type": "referencia_externa", "ownerService": "income-segmentation-service", "description": None,
          "active": True, "currentVersion": "ENIGH 2022", "createdAt": _CUANDO, "createdBy": None}
FUENTES = {"data": [FUENTE], "total": 6, "page": 1, "limit": 20}
VERSION = {"sourceKey": "inegi-enigh", "version": "ENIGH 2024", "description": "Publicada en julio de 2025",
           "origin": "manual", "createdAt": _CUANDO, "createdBy": _USUARIO}
VERSIONES = {"data": [VERSION], "total": 2, "page": 1, "limit": 20}

REGISTRO = {"id": "b8e2f4a6-1c3d-4e5f-9a7b-2c4d6e8f0a1b", "service": "demand-forecast-service",
            "resourceType": "corrida", "resourceId": "674a1f3c9e2b4d0012ab34cd",
            "description": "Pronóstico semanal de Leche entera en Zona Centro",
            "source": {"key": "ventas-core-process", "version": _SHA},
            "inputs": [{"service": "transactions-ingestion-service", "resourceType": "importacion",
                        "resourceId": "05dbdf5a-8342-4d61-bfce-e04e2b644f9b"}],
            "occurredAt": "2026-11-25T18:04:12.317000+00:00", "userId": _USUARIO,
            "correlationId": "7f3c9a2e-41d8-4b6f-9e0a-2c5d8b1f4a63", "registeredAt": "2026-11-25T18:04:12.902000+00:00"}
REGISTROS = {"data": [REGISTRO], "total": 1, "page": 1, "limit": 20}
CUERPO_LINAJE = {k: REGISTRO[k] for k in ("service", "resourceType", "resourceId", "description", "source", "inputs",
                                          "occurredAt")}
ORIGEN = {"depth": 2, "truncated": False, "root": {
    "reference": {"service": "demand-forecast-service", "resourceType": "corrida", "resourceId": REGISTRO["resourceId"]},
    "registered": True, "restricted": False, "record": REGISTRO,
    "source": {"key": "ventas-core-process", "name": "Transacciones confirmadas y canastas", "type": "operacion",
               "ownerService": "core-process-service"},
    "sourceVersion": {"version": _SHA, "createdAt": REGISTRO["registeredAt"], "origin": "linaje"},
    "inputs": [{"reference": REGISTRO["inputs"][0], "registered": False, "restricted": False, "inputs": []}]}}

CALIDAD = {"dateFrom": "2026-11-01", "dateTo": "2026-11-25", "measuredAt": "2026-11-26T09:15:00.000000+00:00",
           "sources": [{"sourceKey": "inegi-enigh", "sourceName": FUENTE["name"],
                        "ownerService": "income-segmentation-service", "sampleSize": 3,
                        "metrics": [{"metric": "freshness", "value": 62.0, "unit": "dias", "numerator": None,
                                     "denominator": None, "disponible": True, "motivo": None, "stale": False}],
                        "rejectedByCode": []}]}
POLITICAS = {"data": [
    {"dataset": "transacciones", "ownerService": "core-process-service", "retentionPeriod": "P3Y",
     "basis": "fecha de la venta", "ownerAction": "El dueño decide cómo aplicarla sobre su almacén (D-43 fija el plazo).",
     "decision": "D-43"},
    {"dataset": "bitacora", "ownerService": "audit-service", "retentionPeriod": None, "basis": "—",
     "ownerAction": "Sin borrado: la bitácora es inmutable (D-43).", "decision": "D-43"}]}
EVALUACION = {"asOf": "2029-09-01", "data": [
    {"dataset": "transacciones", "ownerService": "core-process-service", "retentionPeriod": "P3Y",
     "cutoffDate": "2026-09-01", "expiredCount": 56, "disponible": True, "motivo": None},
    {"dataset": "capturas_disponibilidad", "ownerService": "availability-service", "retentionPeriod": "P1Y",
     "cutoffDate": "2028-09-01", "expiredCount": None, "disponible": False,
     "motivo": "availability-service no filtra capturas por fecha todavía (pedido en el contrato)."}]}
CUERPO_SIMULACION = {"asOf": "2026-11-25", "records": [
    {"dataset": "transacciones", "recordId": "T-SIM-001", "date": "2023-11-25"},
    {"dataset": "transacciones", "recordId": "T-SIM-003", "date": "2024-02-29"}]}
SIMULACION = {"asOf": "2026-11-25", "data": [
    {"dataset": "transacciones", "recordId": "T-SIM-001", "date": "2023-11-25", "expiresOn": "2026-11-25",
     "expired": True},
    {"dataset": "transacciones", "recordId": "T-SIM-003", "date": "2024-02-29", "expiresOn": "2027-03-01",
     "expired": False}], "summary": [{"dataset": "transacciones", "total": 2, "expired": 1}]}


def respuesta(descripcion: str, ejemplo: dict, raiz: str) -> dict:
    """Entrada de `responses=` con el ejemplo en JSON y en XML."""
    return {"description": descripcion, "content": {
        "application/json": {"example": ejemplo},
        "application/xml": {"example": serializar_xml(ejemplo, raiz, namespace=namespace_xml())}}}


_MENSAJES = {
    400: ("VALIDATION_ERROR", "Error de validación en la solicitud."),
    401: ("UNAUTHORIZED", "Sesión inactiva. Vuelve a iniciar sesión."),
    403: ("FORBIDDEN", "Tu rol no tiene permiso para esta operación."),
    404: ("NOT_FOUND", "No existe la fuente precios-competencia."),
    409: ("CONFLICT", "El recurso demand-forecast-service/corrida/674a1f3c9e2b4d0012ab34cd ya tiene linaje con otro "
                      "contenido; el linaje no se sobrescribe (DG-3)."),
    503: ("SERVICE_UNAVAILABLE", "PostgreSQL no responde."),
}


def errores(ruta: str, *estados: int, mensajes: dict[int, str] | None = None) -> dict:
    """Errores estándar de una ruta, en JSON y XML (el XML sin `details`)."""
    salida = {}
    for estado in estados:
        code, message = _MENSAJES[estado]
        message = (mensajes or {}).get(estado, message)
        cuerpo = {"statusCode": estado, "message": message, "code": code, "details": None, "path": ruta,
                  "timestamp": "2026-11-26T09:20:00.000000+00:00"}
        sin_detalles = {k: v for k, v in cuerpo.items() if k != "details"}
        salida[estado] = {"description": message, "content": {
            "application/json": {"example": cuerpo},
            "application/xml": {"example": serializar_xml(sin_detalles, "error", namespace=namespace_xml())}}}
    return salida
