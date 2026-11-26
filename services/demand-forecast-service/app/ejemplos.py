"""Ejemplos de Swagger en JSON y XML (los mismos de `docs/contratos/ejemplos/`, recortados).

El XML se arma con el mismo serializador que usa el servicio, así que el ejemplo y la respuesta
real tienen la misma forma.
"""
from __future__ import annotations

from .xml_out import namespace_xml, serializar_xml

_PRODUCTO = "3f6c2a10-8b4e-4c1d-9a7e-1b2c3d4e5f60"
_ZONA = "97925ca4-3845-4e68-9660-46f781957b8c"
_USUARIO = "5b1e7d3c-2a4f-4e6b-8c9d-0e1f2a3b4c5d"
_SHA = "be303c96b5d5e8779e0b1523319e456ef247713341192eedbc6af536c56876ad"

SUPUESTOS = [
    "Semanas de lunes a domingo, hora de America/Monterrey; la semana en curso no entra.",
    "Cantidades en la unidad base del producto: cantidad × contenido × factor de la unidad (DF-2).",
    "Holt-Winters aditivo (ETS A,A,A) de statsmodels; intervalos 80 % y 95 % analíticos.",
    "El ajuste que valida no ve las 4 semanas reservadas; el pronóstico final usa toda la historia.",
    "Es una proyección de demanda agregada de la zona, no una causa ni un dato de personas.",
]

_PARAMETROS = {"productId": _PRODUCTO, "zoneId": _ZONA, "dateFrom": None, "dateTo": None, "horizonWeeks": 8,
               "holdoutWeeks": 4, "seasonalPeriod": 4, "intervalLevels": [80, 95], "model": "ETS(A,A,A)",
               "publicationRule": "ambos", "minTransactions": 10, "minStores": 3}

CORRIDA = {
    "id": "674a1f3c9e2b4d0012ab34cd", "type": "forecast", "userId": _USUARIO,
    "date": "2026-11-25T18:04:12.317000+00:00", "durationMs": 127.4, "parameters": _PARAMETROS,
    "product": {"id": _PRODUCTO, "name": "Leche entera", "unit": "l", "unitType": "volumen"},
    "zone": {"id": _ZONA, "name": "Zona Centro"}, "disponible": True, "motivo": None,
    "coverage": {"transactions": 1184, "stores": 4},
    "dataVersion": {"sha256": _SHA, "source": "core-process-service", "asOf": "2026-11-25T18:04:11.902000+00:00",
                    "weeks": 20, "effectiveFrom": "2026-07-06", "effectiveTo": "2026-11-22", "zeroWeeks": 1},
    "history": [{"weekStart": "2026-07-06", "quantity": 192.0, "filled": False},
                {"weekStart": "2026-09-07", "quantity": 0.0, "filled": True}],
    "validation": {"trainWeeks": 16, "holdoutWeeks": 4, "mape": 9.880783430220134, "mapeWeeks": 4,
                   "zeroWeeksExcluded": 0, "motivo": None,
                   "holdout": [{"weekStart": "2026-10-26", "actual": 212.0, "forecast": 203.7501270852417}]},
    "forecast": [{"weekStart": "2026-11-23", "quantity": 218.82365533914714, "lower80": 169.57322480441806,
                  "upper80": 268.0740858738762, "lower95": 143.5016217461092, "upper95": 294.14568893218507,
                  "clipped": False}],
    "model": {"library": "statsmodels 0.14.4", "smoothingLevel": 0.0001, "smoothingTrend": 1e-08,
              "smoothingSeasonal": 9.999e-05, "aic": 222.71140552666856},
    "excludedPresentations": [],
    "limitations": ["Estacionalidad de 4 semanas (≈ un mes). La anual necesitaría al menos 108 semanas de historia.",
                    "Una semana sin ventas cuenta como 0 (1 semana rellenada)."],
    "assumptions": SUPUESTOS,
}

NO_DISPONIBLE = {
    "id": "674a20819e2b4d0012ab34ce", "type": "forecast", "userId": _USUARIO,
    "date": "2026-11-25T18:06:40.051000+00:00", "durationMs": 212.4, "parameters": _PARAMETROS,
    "product": CORRIDA["product"], "zone": {"id": _ZONA, "name": "Zona Oriente"}, "disponible": False,
    "motivo": "Menos de 10 transacciones y menos de 3 tiendas con el producto en la zona (D-36).",
    "coverage": {"transactions": 9, "stores": 2}, "excludedPresentations": [], "limitations": [],
    "assumptions": SUPUESTOS,
}

LISTA = {"data": [
    {"id": NO_DISPONIBLE["id"], "date": NO_DISPONIBLE["date"], "userId": _USUARIO, "productId": _PRODUCTO,
     "zoneId": _ZONA, "unit": "l", "disponible": False, "weeks": None, "mape": None, "durationMs": 212.4},
    {"id": CORRIDA["id"], "date": CORRIDA["date"], "userId": _USUARIO, "productId": _PRODUCTO, "zoneId": _ZONA,
     "unit": "l", "disponible": True, "weeks": 20, "mape": 9.880783430220134, "durationMs": 127.4},
], "total": 2, "page": 1, "limit": 20}

REPETICION = {"runId": CORRIDA["id"], "identical": True, "sha256": _SHA, "differences": [], "durationMs": 141.7}

CUERPOS_CORRIDA = {
    "con_zona": {"summary": "Un producto en una zona, toda la historia",
                 "value": {"productId": _PRODUCTO, "zoneId": _ZONA}},
    "ventana": {"summary": "Con ventana (se ajusta a semanas completas)",
                "value": {"productId": _PRODUCTO, "zoneId": _ZONA, "dateFrom": "2026-07-01", "dateTo": "2026-11-22"}},
    "todas_las_zonas": {"summary": "Sin zona: la demanda de todas las zonas sumada",
                        "value": {"productId": _PRODUCTO}},
}


def respuesta(descripcion: str, ejemplo: dict, raiz: str) -> dict:
    """Entrada de `responses=` con el ejemplo en JSON y en XML."""
    return {
        "description": descripcion,
        "content": {
            "application/json": {"example": ejemplo},
            "application/xml": {"example": serializar_xml(ejemplo, raiz, namespace=namespace_xml())},
        },
    }


_MENSAJES = {
    400: ("VALIDATION_ERROR", "Error de validación en la solicitud."),
    401: ("UNAUTHORIZED", "Sesión inactiva. Vuelve a iniciar sesión."),
    403: ("FORBIDDEN", "Tu rol no tiene permiso para esta operación."),
    404: ("NOT_FOUND", f"No existe el producto {_PRODUCTO}."),
    409: ("CONFLICT", "La corrida no está disponible (D-36): no tiene datos que recalcular."),
    422: ("VALIDATION_ERROR", "Hay 11 semanas de historia; el pronóstico necesita al menos 12 (D-40)."),
    503: ("SERVICE_UNAVAILABLE", "MongoDB no responde: no se pudo guardar la corrida."),
}


def errores(ruta: str, *estados: int, mensajes: dict[int, str] | None = None) -> dict:
    """Errores estándar de una ruta, en JSON y XML (el XML sin `details`)."""
    salida = {}
    for estado in estados:
        code, message = _MENSAJES[estado]
        message = (mensajes or {}).get(estado, message)
        cuerpo = {"statusCode": estado, "message": message, "code": code, "details": None,
                  "path": ruta, "timestamp": "2026-11-25T18:07:02.118000+00:00"}
        sin_detalles = {k: v for k, v in cuerpo.items() if k != "details"}
        salida[estado] = {
            "description": message,
            "content": {
                "application/json": {"example": cuerpo},
                "application/xml": {"example": serializar_xml(sin_detalles, "error", namespace=namespace_xml())},
            },
        }
    return salida
