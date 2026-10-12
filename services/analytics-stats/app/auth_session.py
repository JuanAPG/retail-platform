"""Sesión JWT + Redis — NO CAMBIAR su lógica, solo aplicarla como dependencia.
Mismas 3 reglas que el guard Nest (`session.guard.ts`):
1. Firma válida con `JWT_ACCESS_SECRET` (si falla → 401 UNAUTHORIZED).
2. `jti` NO está en `revoked:{jti}` (si está → 401, fue cerrada).
3. Existe `session:{userId}` en Redis (si no → 401, sesión inactiva).
El usuario verificado queda en `request.state.user`.
"""
import os
import redis
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt

_bearer = HTTPBearer(auto_error=False)
_redis: redis.Redis | None = None


# Equivalente del `commandTimeout` del cliente ioredis de los otros 9:
# con Redis detenido pero con el TCP vivo (`docker pause`), un comando sin
# tope de lectura no vuelve nunca y la petición se queda colgada en vez de
# contestar 503.
_TIMEOUT = float(os.getenv("REDIS_COMMAND_TIMEOUT_MS", "2000")) / 1000


def get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.Redis(
            host=os.getenv("REDIS_HOST", "localhost"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            decode_responses=True,
            socket_connect_timeout=_TIMEOUT,
            socket_timeout=_TIMEOUT,
        )
    return _redis


async def sesion_actual(
    request: Request,
    credenciales: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if credenciales is None or credenciales.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Falta el token de sesión (Bearer).")
    try:
        payload = jwt.decode(
            credenciales.credentials, os.getenv("JWT_ACCESS_SECRET", ""), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado.")
    db = get_redis()
    # Fail-closed como el guard Nest: si Redis no responde se rechaza
    # igual, pero con 503 y un mensaje claro — el cliente no debe
    # confundir "la sesión no vale" con "no pude verificar la sesión".
    try:
        revocada = bool(payload.get("jti")) and db.exists(f"revoked:{payload['jti']}")
        activa = db.exists(f"session:{payload['sub']}")
    except redis.RedisError as error:
        raise HTTPException(
            status_code=503,
            detail="No se pudo verificar la sesión: el servicio de sesiones no responde.",
        ) from error
    if revocada:
        raise HTTPException(status_code=401, detail="Sesión cerrada. Vuelve a iniciar sesión.")
    if not activa:
        raise HTTPException(status_code=401, detail="Sesión inactiva. Vuelve a iniciar sesión.")
    usuario = {"id": payload["sub"], "email": payload.get("email"),
               "rol": payload.get("rol"), "rolId": payload.get("rolId")}
    request.state.user = usuario
    return usuario
