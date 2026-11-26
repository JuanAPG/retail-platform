"""Logging por operación — NO CAMBIAR su formato.
Una línea JSON por request a stdout, igual que el interceptor Nest:
`{ timestamp, level, service, requestId, correlationId, method, path, statusCode, durationMs, userId? }`.

También abre el contexto del id de correlación (T-02): todo lo que corre
dentro (dependencias, handlers, llamadas a otros servicios) ve el mismo id.
"""
import json
import logging
import os
import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .correlacion import CABECERA_CORRELACION, fijar, id_de_correlacion, soltar

logger = logging.getLogger("http")
logging.basicConfig(level=logging.INFO, format="%(message)s")


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        inicio = time.time()
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
        correlation_id = id_de_correlacion(request.headers.get(CABECERA_CORRELACION))
        request.state.correlation_id = correlation_id
        token = fijar(correlation_id)
        try:
            respuesta = await call_next(request)
        finally:
            soltar(token)
        respuesta.headers["x-request-id"] = request_id
        respuesta.headers["X-Correlation-Id"] = correlation_id
        usuario = getattr(getattr(request, "state", None), "user", None)
        logger.info(json.dumps({
            "timestamp": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc).isoformat(),
            "level": "log",
            "service": os.getenv("SERVICE_NAME", "unknown-service"),
            "requestId": request_id,
            "correlationId": correlation_id,
            "method": request.method,
            "path": request.url.path,
            "statusCode": respuesta.status_code,
            "durationMs": int((time.time() - inicio) * 1000),
            **({"userId": usuario.get("id")} if isinstance(usuario, dict) and usuario.get("id") else {}),
        }))
        return respuesta
