"""Cuerpo de error estándar — NO CAMBIAR su forma.
Espejo exacto del filtro Nest (`http-error.filter.ts`):
`{ statusCode, message, code, details, path, timestamp }`.
`code` solo admite valores de `services/snippets/error-codes.md`.
"""
from fastapi.responses import JSONResponse

CODE_POR_STATUS = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    413: "VALIDATION_ERROR",
    415: "VALIDATION_ERROR",
    # FastAPI devuelve 422 para el mismo caso que Nest reporta como 400:
    # un cuerpo que no paso la validacion.
    422: "VALIDATION_ERROR",
    503: "SERVICE_UNAVAILABLE",
}


def cuerpo_error(status: int, message: str, path: str, code: str | None = None,
                 details: object = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "statusCode": status,
            "message": message,
            "code": code or CODE_POR_STATUS.get(status, "INTERNAL"),
            "details": details,
            "path": path,
            "timestamp": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc).isoformat(),
        },
    )
