"""La sesión real (`app.auth_session.sesion_actual`), sin el override de las demás pruebas.

Mismas reglas que el SessionGuard de Nest: sesión activa → pasa; sin `session:{id}` o con el `jti`
revocado → 401; Redis que no responde → **503** `SERVICE_UNAVAILABLE` (fail-closed), nunca 500.
Antes de este arreglo, un Redis caído reventaba como 500 (lo encontró `carga/medir/redis_caido.py`).
Un Redis falso evita depender de uno real.
"""
import asyncio
import os
import time

os.environ.setdefault("JWT_ACCESS_SECRET", "secreto_solo_para_pruebas")

import jwt
import pytest
import redis
from fastapi import HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app import auth_session
from app.main import app


class RedisFalso:
    def __init__(self, llaves=(), error: Exception | None = None):
        self.llaves, self.error = set(llaves), error

    def exists(self, llave: str) -> int:
        if self.error:
            raise self.error
        return int(llave in self.llaves)


class Credencial:
    scheme = 'Bearer'

    def __init__(self, token: str):
        self.credentials = token


class Peticion:
    def __init__(self):
        self.state = type('Estado', (), {})()


def token(sub='u-1', jti='j-1') -> str:
    return jwt.encode({'sub': sub, 'jti': jti, 'email': 'a@retail.mx', 'rol': 'Analista comercial',
                       'exp': int(time.time()) + 300}, os.environ['JWT_ACCESS_SECRET'], algorithm='HS256')


@pytest.fixture
def redis_falso(monkeypatch):
    def poner(falso):
        monkeypatch.setattr(auth_session, '_redis', falso)   # get_redis() devuelve el cliente ya creado
    yield poner


def sesion():
    return asyncio.run(auth_session.sesion_actual(Peticion(), Credencial(token())))


def test_sesion_activa_pasa(redis_falso):
    redis_falso(RedisFalso({'session:u-1'}))
    assert sesion()['id'] == 'u-1'


@pytest.mark.parametrize('llaves', [set(), {'session:u-1', 'revoked:j-1'}], ids=['sin-sesion', 'revocada'])
def test_sesion_inactiva_o_revocada_es_401(redis_falso, llaves):
    redis_falso(RedisFalso(llaves))
    with pytest.raises(HTTPException) as e:
        sesion()
    assert e.value.status_code == 401


@pytest.mark.parametrize('error', [redis.ConnectionError('Connection refused'), redis.TimeoutError('Timeout reading')],
                         ids=['caido', 'colgado'])
def test_redis_que_no_responde_es_503(redis_falso, error):
    redis_falso(RedisFalso(error=error))
    with pytest.raises(HTTPException) as e:
        sesion()
    assert e.value.status_code == 503


def test_cliente_con_tope_de_lectura(monkeypatch):
    """`socket_timeout`: con Redis pausado (TCP vivo) un comando sin tope colgaría la petición."""
    monkeypatch.setattr(auth_session, '_redis', None)
    cliente = auth_session.get_redis()
    opciones = cliente.connection_pool.connection_kwargs
    assert opciones['socket_timeout'] == opciones['socket_connect_timeout'] == 2.0
    monkeypatch.setattr(auth_session, '_redis', None)


def _usa_sesion(dependant) -> bool:
    return any(d.call is auth_session.sesion_actual or _usa_sesion(d) for d in dependant.dependencies)


def test_ruta_protegida_responde_503_estandar(redis_falso):
    """De punta a punta: el manejador de errores convierte el 503 en el cuerpo estándar."""
    rutas = [r.path for r in app.routes if isinstance(r, APIRoute) and 'GET' in r.methods
             and '{' not in r.path and _usa_sesion(r.dependant)]
    if not rutas:
        pytest.skip('Este servicio no tiene rutas protegidas (plantilla).')
    redis_falso(RedisFalso(error=redis.ConnectionError('Connection refused')))
    respaldo = app.dependency_overrides.pop(auth_session.sesion_actual, None)
    try:
        r = TestClient(app).get(rutas[0], headers={'Authorization': f'Bearer {token()}', 'Accept': 'application/json'})
    finally:
        if respaldo is not None:
            app.dependency_overrides[auth_session.sesion_actual] = respaldo
    assert r.status_code == 503, r.text
    assert r.json()['code'] == 'SERVICE_UNAVAILABLE'
