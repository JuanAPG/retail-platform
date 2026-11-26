"""Lecturas de core-process, catalog e income-segmentation con un transporte HTTP falso."""
from datetime import date

import httpx
import pytest
from fastapi import HTTPException

from app.correlacion import fijar, soltar
from app.fuentes import Fuentes

ZONA = "97925ca4-3845-4e68-9660-46f781957b8c"


def fuentes(manejador, autorizacion="Bearer tok"):
    return Fuentes(autorizacion, httpx.Client(transport=httpx.MockTransport(manejador)))


def test_zona_segmento_y_categorias():
    def manejador(peticion):
        ruta = peticion.url.path
        if ruta == f"/v1/zones/{ZONA}":
            return httpx.Response(200, json={"id": ZONA, "nombre": "Zona Centro", "activo": True})
        if ruta == "/v1/segments/2":
            return httpx.Response(200, json={"id": 2, "code": "ING_2", "name": "Ingreso medio", "source": "INEGI"})
        return httpx.Response(200, json=[{"id": 1, "nombre": "Abarrotes"}, {"id": 2, "nombre": "Lácteos"}])

    f = fuentes(manejador)
    assert f.zona(ZONA) == {"id": ZONA, "name": "Zona Centro"}
    assert f.segmento(2) == {"id": 2, "code": "ING_2", "name": "Ingreso medio"}
    assert f.categorias() == {1: "Abarrotes", 2: "Lácteos"}


@pytest.mark.parametrize("metodo, argumento, mensaje", [("zona", ZONA, f"No existe la zona {ZONA}."),
                                                        ("segmento", 9, "No existe el segmento 9.")])
def test_inexistente_da_404_con_el_id(metodo, argumento, mensaje):
    f = fuentes(lambda _: httpx.Response(404, json={"message": "Not found"}))
    with pytest.raises(HTTPException) as error:
        getattr(f, metodo)(argumento)
    assert (error.value.status_code, error.value.detail) == (404, mensaje)


def test_historial_recorre_todas_las_paginas():
    pedidas = []

    def manejador(peticion):
        pagina = int(peticion.url.params["page"])
        pedidas.append(pagina)
        filas = [{"segmentId": 2, "segmentVersion": pagina}] * (100 if pagina < 3 else 5)
        return httpx.Response(200, json={"data": filas, "total": 205, "page": pagina, "limit": 100})

    assert len(fuentes(manejador).historial(ZONA)) == 205
    assert pedidas == [1, 2, 3]


def test_canastas_por_producto_manda_solo_los_filtros_que_hay():
    pedidas = []

    def manejador(peticion):
        pedidas.append((peticion.url.path, dict(peticion.url.params)))
        return httpx.Response(200, json={"periods": [], "data": [], "asOf": "x"})

    f = fuentes(manejador)
    f.canastas_por_producto(ZONA, 2, None, None)
    f.canastas_por_producto(ZONA, 2, date(2026, 10, 1), date(2026, 10, 31), "2026-11-25T18:20:00Z", "month")
    f.gasto_por_categoria(ZONA, 2, date(2026, 10, 1), None)

    assert pedidas[0] == ("/v1/analytics/basket-products", {"zoneId": ZONA, "segmentId": "2"})
    assert pedidas[1][1] == {"zoneId": ZONA, "segmentId": "2", "dateFrom": "2026-10-01", "dateTo": "2026-10-31",
                             "asOf": "2026-11-25T18:20:00Z", "groupBy": "month"}
    assert pedidas[2] == ("/v1/analytics/spend-by-category", {"zoneId": ZONA, "segmentId": "2", "dateFrom": "2026-10-01"})


def test_reenvia_token_y_correlacion():
    vistos = {}

    def manejador(peticion):
        vistos.update(peticion.headers)
        return httpx.Response(200, json=[])

    token = fijar("op-canasta-1")
    try:
        fuentes(manejador, "Bearer abc").categorias()
    finally:
        soltar(token)
    assert vistos["authorization"] == "Bearer abc"
    assert vistos["x-correlation-id"] == "op-canasta-1"


@pytest.mark.parametrize("respuesta", [httpx.Response(500, json={"message": "boom"}),
                                       httpx.Response(502, text="Bad Gateway")])
def test_servicio_con_5xx_da_503(respuesta):
    with pytest.raises(HTTPException) as error:
        fuentes(lambda _: respuesta).canastas_por_producto(ZONA, 2, None, None)
    assert error.value.status_code == 503
    assert "core-process-service" in error.value.detail


@pytest.mark.parametrize("falla, texto", [(httpx.ReadTimeout("lento"), "no respondió en 3 s"),
                                          (httpx.ConnectError("caído"), "No se pudo contactar")])
def test_timeout_o_sin_conexion_da_503(falla, texto):
    def manejador(_):
        raise falla

    with pytest.raises(HTTPException) as error:
        fuentes(manejador).segmento(2)
    assert error.value.status_code == 503
    assert "income-segmentation-service" in error.value.detail and texto in error.value.detail


def test_401_o_403_de_otro_servicio_se_propagan():
    f = fuentes(lambda _: httpx.Response(403, json={"message": "Tu rol no tiene permiso."}))
    with pytest.raises(HTTPException) as error:
        f.gasto_por_categoria(ZONA, 2, None, None)
    assert (error.value.status_code, error.value.detail) == (403, "Tu rol no tiene permiso.")
