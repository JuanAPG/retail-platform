"""Raíz de la plantilla FastAPI. Cada endpoint de negocio cuelga de /v1/.
`/docs` queda fuera del versionado. Responde JSON y XML según `Accept`
(igual que el interceptor Nest); el XSD de cada endpoint vive en
`docs/contratos/` (Fase A).
"""
import os
import xml.etree.ElementTree as ET
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from .errors import cuerpo_error
from .logging_conf import LoggingMiddleware

app = FastAPI(
    title=os.getenv("SERVICE_NAME", "unknown-service"),
    version=os.getenv("SERVICE_VERSION", "1.0.0"),
    docs_url="/docs",
    redoc_url=None,
)
app.add_middleware(LoggingMiddleware)


@app.exception_handler(StarletteHTTPException)
async def manejador_http(request: Request, error: StarletteHTTPException):
    detalle = error.detail if isinstance(error.detail, str) else None
    datos = None if isinstance(error.detail, str) else error.detail
    return cuerpo_error(error.status_code, detalle or "Error en la solicitud",
                        request.url.path, None, datos)


@app.exception_handler(RequestValidationError)
async def manejador_validacion(request: Request, error: RequestValidationError):
    return cuerpo_error(400, "Error de validación en la solicitud.",
                        request.url.path, "VALIDATION_ERROR", error.errors())


@app.exception_handler(Exception)
async def manejador_general(request: Request, _error: Exception):
    return cuerpo_error(500, "Error interno del servidor.", request.url.path)


def _a_xml(datos: object) -> str:
    raiz = ET.Element("response")
    _llenar(raiz, datos)
    return ET.tostring(raiz, encoding="unicode", xml_declaration=True)


def _llenar(nodo: ET.Element, datos: object) -> None:
    if isinstance(datos, dict):
        for clave, valor in datos.items():
            hijo = ET.SubElement(nodo, str(clave))
            _llenar(hijo, valor)
    elif isinstance(datos, list):
        for valor in datos:
            hijo = ET.SubElement(nodo, "item")
            _llenar(hijo, valor)
    else:
        nodo.text = "" if datos is None else str(datos)


@app.get("/v1/health", summary="Salud del servicio.")
def salud():
    """Sin autenticación. `status` siempre es `ok` si el proceso responde."""
    return {
        "status": "ok",
        "service": os.getenv("SERVICE_NAME", "unknown-service"),
        "version": os.getenv("SERVICE_VERSION", "1.0.0"),
        "timestamp": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).isoformat(),
    }


@app.middleware("http")
async def negociar_xml(request: Request, call_next):
    """Si `Accept: application/xml`, serializa el JSON a XML (UTF-8)."""
    respuesta = await call_next(request)
    if "application/xml" not in (request.headers.get("accept") or ""):
        return respuesta
    import json as _json
    cuerpo = b""
    async for fragmento in respuesta.body_iterator:
        cuerpo += fragmento
    try:
        datos = _json.loads(cuerpo or b"null")
    except ValueError:
        return respuesta
    return Response(content=_a_xml(datos), media_type="application/xml; charset=utf-8",
                    status_code=respuesta.status_code)
