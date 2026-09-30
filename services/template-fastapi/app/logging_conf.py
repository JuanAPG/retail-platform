"""Logging por operación — NO CAMBIAR su formato.
Una línea JSON por request a stdout, igual que el interceptor Nest:
`{ timestamp, level, service, requestId, method, path, statusCode, durationMs, userId? }`.
"""
import json
import logging
import os
import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("http")
logging.basicConfig(level=logging.INFO, format="%(message)s")


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        inicio = time.time()
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
        respuesta = await call_next(request)
        respuesta.headers["x-request-id"] = request_id
        usuario = getattr(getattr(request, "state", None), "user", None)
        logger.info(json.dumps({
            "timestamp": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc).isoformat(),
            "level": "log",
            "service": os.getenv("SERVICE_NAME", "unknown-service"),
            "requestId": request_id,
            "method": request.method,
            "path": request.url.path,
            "statusCode": respuesta.status_code,
            "durationMs": int((time.time() - inicio) * 1000),
            **({"userId": usuario.get("id")} if isinstance(usuario, dict) and usuario.get("id") else {}),
        }))
        return respuesta
