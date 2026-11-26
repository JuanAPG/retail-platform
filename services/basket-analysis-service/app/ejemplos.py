"""Ejemplos de Swagger en JSON y XML (los de `docs/contratos/ejemplos/basket-analysis-*`, recortados).

El XML se arma con el mismo serializador que usa el servicio, así que el ejemplo y la respuesta
real tienen la misma forma.
"""
from __future__ import annotations

from .xml_out import namespace_xml, serializar_xml

_ZONA = "97925ca4-3845-4e68-9660-46f781957b8c"
_AS_OF = "2026-11-25T18:20:00.000000+00:00"
_GRUPO = {"zone": {"id": _ZONA, "name": "Zona Centro"},
          "segment": {"id": 2, "code": "ING_2", "name": "Ingreso medio", "versions": [1]}}

SUPUESTOS = [
    "Grupo = zona + segmento congelado en cada canasta al construirla (RN-02).",
    "Un producto cuenta una vez por canasta aunque lleve varias presentaciones.",
    "Canasta típica: productos en al menos el 20 % de las canastas del grupo (D-37).",
    "Gasto promedio: lo gastado en el producto entre las canastas que lo llevan (MXN).",
    "Describe al grupo agregado, nunca a una persona.",
]

TIPICA = {
    "group": _GRUPO, "period": {"dateFrom": "2026-10-01", "dateTo": "2026-10-31"}, "asOf": _AS_OF,
    "threshold": 0.2, "publicationRule": "ambos", "minTransactions": 10, "minStores": 3,
    "coverage": {"baskets": 100, "stores": 4}, "disponible": True, "motivo": None,
    "summary": {"baskets": 100, "totalSpend": 10983.5, "averageTicket": 109.83, "productsPerBasket": 2.3,
                "basketsPerWeek": 22.58064516129032},
    "products": [
        {"productId": "a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c05", "productName": "Queso panela", "categoryId": 2,
         "categoryName": "Lácteos", "basketsWithProduct": 20, "frequency": 0.2, "averageSpend": 55.5, "typical": True},
        {"productId": "a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c06", "productName": "Quinoa orgánica", "categoryId": 1,
         "categoryName": "Abarrotes", "basketsWithProduct": 19, "frequency": 0.19, "averageSpend": 92.0, "typical": False},
    ],
    "typicalSize": 5,
    "dataVersion": {"sha256": "6709f690c3b6b1d0f84b1e3b51f7d29e9b0ad2c3f7a4ce3f0a2f3e1d5c6b7a89",
                    "source": "core-process-service", "asOf": _AS_OF},
    "assumptions": SUPUESTOS,
}

NO_DISPONIBLE = {
    **{k: TIPICA[k] for k in ("group", "asOf", "threshold", "publicationRule", "minTransactions", "minStores")},
    "period": {"dateFrom": "2026-08-01", "dateTo": "2026-09-30"}, "coverage": {"baskets": 40, "stores": 1},
    "disponible": False,
    "motivo": "La combinación zona-segmento tiene 1 tienda (mínimo 3) con 40 canastas (D-36, regla ambos).",
    "summary": None, "products": None, "typicalSize": None, "dataVersion": None, "assumptions": [],
}

COMPARACION = {
    "group": _GRUPO, "asOf": _AS_OF, "threshold": 0.2, "publicationRule": "ambos",
    "periodA": {"dateFrom": "2026-09-01", "dateTo": "2026-09-30", "disponible": True, "motivo": None,
                "coverage": {"baskets": 100, "stores": 4}},
    "periodB": {"dateFrom": "2026-10-01", "dateTo": "2026-10-31", "disponible": True, "motivo": None,
                "coverage": {"baskets": 100, "stores": 4}},
    "disponible": True, "motivo": None,
    "entering": [{"productId": "a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c05", "productName": "Queso panela",
                  "frequencyA": 0.0, "frequencyB": 0.2, "averageSpendA": None, "averageSpendB": 55.5,
                  "frequencyChange": 0.2}],
    "leaving": [{"productId": "a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c06", "productName": "Quinoa orgánica",
                 "frequencyA": 0.22, "frequencyB": 0.19, "averageSpendA": 92.0, "averageSpendB": 92.0,
                 "frequencyChange": -0.03}],
    "staying": [],
    "indicators": [{"indicator": "averageTicket", "a": 100.64, "b": 109.83, "change": 9.19,
                    "changePercent": 9.13155802861685}],
}

EVOLUCION = {
    "group": _GRUPO, "granularity": "month", "asOf": _AS_OF, "publicationRule": "ambos",
    "data": [
        {"periodStart": "2026-08-01", "periodEnd": "2026-08-31", "coverage": {"baskets": 9, "stores": 3},
         "disponible": False,
         "motivo": "La combinación zona-segmento tiene 9 transacciones (mínimo 10) en 3 tiendas (D-36, regla ambos).",
         "averageTicket": None, "productsPerBasket": None, "typicalSize": None},
        {"periodStart": "2026-09-01", "periodEnd": "2026-09-30", "coverage": {"baskets": 100, "stores": 4},
         "disponible": True, "motivo": None, "averageTicket": 100.64, "productsPerBasket": 2.13, "typicalSize": 5},
    ],
}

MEZCLA = {
    "group": _GRUPO, "period": {"dateFrom": "2026-10-01", "dateTo": "2026-10-31"}, "publicationRule": "ambos",
    "coverage": {"baskets": 100, "stores": 4}, "disponible": True, "motivo": None,
    "data": [{"categoryId": 2, "categoryName": "Lácteos", "totalSpend": 4644.0, "basketCount": 62, "share": 42.28},
             {"categoryId": 1, "categoryName": "Abarrotes", "totalSpend": 3490.5, "basketCount": 60, "share": 31.78}],
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
    404: ("NOT_FOUND", f"No existe la zona {_ZONA}."),
    503: ("SERVICE_UNAVAILABLE", "core-process-service no respondió en 3 s."),
}


def errores(ruta: str, *estados: int, mensajes: dict[int, str] | None = None) -> dict:
    """Errores estándar de una ruta, en JSON y XML (el XML sin `details`)."""
    salida = {}
    for estado in estados:
        code, message = _MENSAJES[estado]
        message = (mensajes or {}).get(estado, message)
        cuerpo = {"statusCode": estado, "message": message, "code": code, "details": None,
                  "path": ruta, "timestamp": "2026-11-25T18:21:04.512000+00:00"}
        sin_detalles = {k: v for k, v in cuerpo.items() if k != "details"}
        salida[estado] = {
            "description": message,
            "content": {
                "application/json": {"example": cuerpo},
                "application/xml": {"example": serializar_xml(sin_detalles, "error", namespace=namespace_xml())},
            },
        }
    return salida
