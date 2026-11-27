"""Lecturas de catalog-service y core-process-service con un transporte HTTP falso."""
from datetime import date

import httpx
import pytest
from fastapi import HTTPException

from app.correlacion import fijar, soltar
from app.fuentes import Fuentes

PRODUCTO = "3f6c2a10-8b4e-4c1d-9a7e-1b2c3d4e5f60"
ZONA = "97925ca4-3845-4e68-9660-46f781957b8c"


def fuentes(manejador, autorizacion="Bearer tok"):
    return Fuentes(autorizacion, httpx.Client(transport=httpx.MockTransport(manejador)))


def test_producto_y_zona_con_su_nombre():
    def manejador(peticion):
        if peticion.url.path == f"/v1/products/{PRODUCTO}":
            return httpx.Response(200, json={"id": PRODUCTO, "nombre": "Leche entera", "sku": "LDN-LEC"})
        return httpx.Response(200, json={"id": ZONA, "nombre": "Zona Centro"})

    f = fuentes(manejador)
    assert f.producto(PRODUCTO) == {"id": PRODUCTO, "name": "Leche entera"}
    assert f.zona(ZONA) == {"id": ZONA, "name": "Zona Centro"}


@pytest.mark.parametrize("metodo, mensaje", [("producto", f"No existe el producto {PRODUCTO}."),
                                             ("zona", f"No existe la zona {PRODUCTO}.")])
def test_inexistente_da_404_con_el_id(metodo, mensaje):
    f = fuentes(lambda _: httpx.Response(404, json={"message": "Not found"}))
    with pytest.raises(HTTPException) as error:
        getattr(f, metodo)(PRODUCTO)
    assert (error.value.status_code, error.value.detail) == (404, mensaje)


def test_reenvia_token_y_correlacion():
    vistos = {}

    def manejador(peticion):
        vistos.update(peticion.headers)
        return httpx.Response(200, json=[])

    token = fijar("op-pronostico-1")
    try:
        fuentes(manejador, "Bearer abc").presentaciones(PRODUCTO)
    finally:
        soltar(token)
    assert vistos["authorization"] == "Bearer abc"
    assert vistos["x-correlation-id"] == "op-pronostico-1"


def test_ventas_semanales_manda_solo_los_filtros_que_hay():
    pedidas = []

    def manejador(peticion):
        pedidas.append(dict(peticion.url.params))
        return httpx.Response(200, json={"transactions": 0, "stores": 0, "data": [], "asOf": "x"})

    f = fuentes(manejador)
    f.ventas_semanales(PRODUCTO, None, None, date(2026, 11, 22))
    f.ventas_semanales(PRODUCTO, ZONA, date(2026, 7, 6), date(2026, 11, 22))

    assert pedidas[0] == {"productId": PRODUCTO, "dateTo": "2026-11-22"}
    assert pedidas[1] == {"productId": PRODUCTO, "zoneId": ZONA, "dateFrom": "2026-07-06", "dateTo": "2026-11-22"}


@pytest.mark.parametrize("respuesta", [
    httpx.Response(500, json={"message": "boom"}),
    httpx.Response(503, text="Service Unavailable"),
])
def test_servicio_con_5xx_da_503(respuesta):
    with pytest.raises(HTTPException) as error:
        fuentes(lambda _: respuesta).ventas_semanales(PRODUCTO, None, None, date(2026, 11, 22))
    assert error.value.status_code == 503
    assert "core-process-service" in error.value.detail


@pytest.mark.parametrize("falla, texto", [(httpx.ReadTimeout("lento"), "no respondió en 3 s"),
                                          (httpx.ConnectError("caído"), "No se pudo contactar")])
def test_timeout_o_sin_conexion_da_503(falla, texto):
    def manejador(_):
        raise falla

    with pytest.raises(HTTPException) as error:
        fuentes(manejador).producto(PRODUCTO)
    assert error.value.status_code == 503
    assert texto in error.value.detail


def test_401_o_403_de_otro_servicio_se_propagan():
    f = fuentes(lambda _: httpx.Response(403, json={"message": "Tu rol no tiene permiso."}))
    with pytest.raises(HTTPException) as error:
        f.ventas_semanales(PRODUCTO, None, None, date(2026, 11, 22))
    assert (error.value.status_code, error.value.detail) == (403, "Tu rol no tiene permiso.")
