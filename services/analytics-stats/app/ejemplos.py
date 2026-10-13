"""Ejemplos de Swagger en JSON **y** XML (estándar transversal).

El XML se genera desde el ejemplo JSON con el mismo `serializar_xml` que usa
el middleware, así que el ejemplo es exactamente lo que el servicio emite.
"""
from .xml_out import namespace_xml, serializar_xml

_SUPUESTOS = ["Welch: no supone que los dos grupos tengan la misma varianza.",
              "Grupos independientes: cada valor pertenece a un solo grupo."]

#: Ticket real del CSV de 100 canastas (db/datos_prueba_100_canastas.csv).
HIPOTESIS = {
    "test": "welch",
    "statistic": 8.271863737062235,
    "pValue": 1.1695308337398335e-11,
    "degreesOfFreedom": 63.19294386768545,
    "alpha": 0.05,
    "alternative": "two-sided",
    "rejectNull": True,
    "conclusion": "Con α = 0.05 hay diferencia estadística entre Ingreso alto e Ingreso bajo (p < 0.0001). "
                  "Es una diferencia en estos datos; no prueba una causa.",
    "groups": [
        {"label": "Ingreso alto", "n": 42, "mean": 143.20238095238096, "median": 142.0,
         "standardDeviation": 35.49288137555389},
        {"label": "Ingreso bajo", "n": 30, "mean": 73.63333333333334, "median": 73.75,
         "standardDeviation": 34.95981272471473},
    ],
    "source": None,
    "assumptions": _SUPUESTOS,
}

ANOVA = {
    "test": "anova",
    "statistic": 44.75477063363583,
    "pValue": 1.0276038606868197e-14,
    "dfBetween": 2,
    "dfWithin": 103,
    "degreesOfFreedom": None,
    "alpha": 0.05,
    "rejectNull": True,
    "conclusion": "Con α = 0.05 al menos uno de los 3 grupos difiere de los demás (p < 0.0001). "
                  "Es una diferencia en estos datos; no prueba una causa.",
    "groups": HIPOTESIS["groups"] + [
        {"label": "Ingreso medio", "n": 34, "mean": 96.3970588235294, "median": 109.5,
         "standardDeviation": 23.872698813982083}],
    "source": None,
    "assumptions": ["ANOVA de un factor: supone varianzas parecidas entre grupos y datos cercanos a la normal en cada uno.",
                    "ANOVA dice si al menos un grupo difiere de los demás, no cuál."],
}

PROPORCIONES = {
    "test": "ztest",
    "statistic": 2.6668027176178364,
    "pValue": 0.007657660828146556,
    "degreesOfFreedom": None,
    "difference": 0.3142857142857143,
    "alpha": 0.05,
    "rejectNull": True,
    "conclusion": "Con α = 0.05 la proporción difiere entre Ingreso alto e Ingreso bajo (p = 0.0077). "
                  "Es una diferencia en estos datos; no prueba una causa.",
    "groups": [{"label": "Ingreso alto", "successes": 30, "total": 42, "proportion": 0.7142857142857143},
               {"label": "Ingreso bajo", "successes": 12, "total": 30, "proportion": 0.4}],
    "source": None,
    "assumptions": ["Prueba z de dos proporciones con la proporción combinada, de dos lados."],
}


def _cuerpos(con_valores: dict, con_canastas: dict) -> dict:
    """Los dos modos de pedir una prueba, como ejemplos del cuerpo en Swagger."""
    return {
        "canastas": {"summary": "Desde las canastas (modo baskets)", "value": con_canastas},
        "valores": {"summary": "Valores en el cuerpo (groups)", "value": con_valores},
    }


_VALORES = [{"label": "Ingreso alto", "values": [142.0, 170.5, 98.0, 120.0, 155.5, 133.0, 160.0, 149.5]},
            {"label": "Ingreso bajo", "values": [108.0, 36.0, 72.0, 55.5, 90.0, 61.0, 80.5, 47.0]}]
CUERPOS_HIPOTESIS = _cuerpos(
    {"groups": _VALORES},
    {"baskets": {"metric": "totalValue", "groupBy": "segment", "groupIds": ["3", "1"]}},
)
CUERPOS_ANOVA = _cuerpos(
    {"groups": _VALORES + [{"label": "Ingreso medio", "values": [109.5, 96.0, 88.0, 120.0, 75.5, 101.0]}]},
    {"baskets": {"metric": "totalValue", "groupBy": "segment", "groupIds": ["1", "2", "3"]}},
)
CUERPOS_PROPORCIONES = _cuerpos(
    {"groups": [{"label": "Ingreso alto", "successes": 30, "total": 42},
                {"label": "Ingreso bajo", "successes": 12, "total": 30}]},
    {"baskets": {"condition": "hasBasicProducts", "groupBy": "segment", "groupIds": ["3", "1"]}},
)


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
    400: ("VALIDATION_ERROR", "El grupo «Ingreso bajo» tiene 1 valor(es); se necesitan al menos 2."),
    401: ("UNAUTHORIZED", "Sesión inactiva. Vuelve a iniciar sesión."),
    403: ("FORBIDDEN", "Tu rol no tiene permiso para esta operación."),
    404: ("NOT_FOUND", "No existe el segmento 9."),
    503: ("SERVICE_UNAVAILABLE", "No se pudo verificar la sesión: el servicio de sesiones no responde."),
}


def errores(ruta: str, *estados: int) -> dict:
    """Errores estándar de una ruta, en JSON y XML (el XML sin `details`)."""
    salida = {}
    for estado in estados:
        code, message = _MENSAJES[estado]
        cuerpo = {"statusCode": estado, "message": message, "code": code, "details": None,
                  "path": ruta, "timestamp": "2026-10-12T22:15:03.123456+00:00"}
        sin_detalles = {k: v for k, v in cuerpo.items() if k != "details"}
        salida[estado] = {
            "description": message,
            "content": {
                "application/json": {"example": cuerpo},
                "application/xml": {"example": serializar_xml(sin_detalles, "error", namespace=namespace_xml())},
            },
        }
    return salida
