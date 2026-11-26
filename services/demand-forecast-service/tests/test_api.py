"""Las rutas de punta a punta con fuentes falsas, Mongo en memoria y sesión simulada.

Cada respuesta XML se valida contra `docs/contratos/demand-forecast-service.xsd` (lxml). Los
avisos de fondo (bitácora, aviso, linaje) se capturan en vez de enviarse.
"""
from datetime import timedelta
from pathlib import Path

import mongomock
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from lxml import etree

from app import avisos
from app.auth_session import sesion_actual
from app.corridas import Corridas, obtener_corridas
from app.fuentes import obtener_fuentes
from app.main import app
from app.roles import PERFILES_INTERNOS, ROL
from app.semanas import lunes_de

XSD = etree.XMLSchema(etree.parse(str(Path(__file__).resolve().parents[3] / "docs/contratos/demand-forecast-service.xsd")))
PRODUCTO = "3f6c2a10-8b4e-4c1d-9a7e-1b2c3d4e5f60"
ZONA = "97925ca4-3845-4e68-9660-46f781957b8c"
USUARIO = "5b1e7d3c-2a4f-4e6b-8c9d-0e1f2a3b4c5d"
KG_1 = {"id": "kg1", "contenido": "1.000", "unidadMedida": {"clave": "kg", "tipo": "masa", "factorBase": "1.000000"}}
PZA_12 = {"id": "pza12", "contenido": "12.000", "unidadMedida": {"clave": "pza", "tipo": "pieza", "factorBase": "1"}}
TODOS_LOS_ROLES = (*PERFILES_INTERNOS, ROL.PROVEEDOR, ROL.INVESTIGADOR)


def patron(t):
    return 40 + t + [8, 0, -5, -3][t % 4]


class FuentesFalsas:
    """Lo mínimo de catalog y core-process. `semanas` de venta que terminan en la última completa."""

    def __init__(self, semanas=20, transacciones=40, tiendas=4, presentaciones=(KG_1,), vendidas=("kg1",)):
        self.semanas, self.transacciones, self.tiendas = semanas, transacciones, tiendas
        self._presentaciones, self._vendidas = list(presentaciones), vendidas
        self.pedidas = []
        self.falta = None

    def producto(self, pid):
        if self.falta == "producto":
            raise HTTPException(404, f"No existe el producto {pid}.")
        if self.falta == "catalogo":
            raise HTTPException(503, "catalog-service no respondió en 3 s.")
        return {"id": pid, "name": "Azúcar estándar"}

    def zona(self, zid):
        return {"id": zid, "name": "Zona Valle"}

    def presentaciones(self, _pid):
        return self._presentaciones

    def ventas_semanales(self, pid, zid, desde, hasta):
        self.pedidas.append((pid, zid, desde, hasta))
        ultima = lunes_de(hasta)
        filas = [{"weekStart": (ultima - timedelta(weeks=self.semanas - 1 - t)).isoformat(),
                  "presentationId": pres, "quantity": patron(t), "transactions": 3}
                 for t in range(self.semanas) for pres in self._vendidas]
        return {"transactions": self.transacciones, "stores": self.tiendas, "asOf": "2026-11-26T18:00:00.000Z",
                "data": filas}


@pytest.fixture
def entorno(monkeypatch):
    fuentes = FuentesFalsas()
    repo = Corridas(mongomock.MongoClient("mongodb://localhost:27017/retaildb", tz_aware=True))
    enviados = []
    monkeypatch.setattr(avisos, "_enviar", lambda variable, ruta, cuerpo, ctx, que: enviados.append(
        {"variable": variable, "ruta": ruta, "cuerpo": cuerpo, "ctx": ctx}))
    estado = {"rol": ROL.ANALISTA}
    app.dependency_overrides[sesion_actual] = lambda: {"id": USUARIO, "rol": estado["rol"], "email": "a@retail.mx"}
    app.dependency_overrides[obtener_fuentes] = lambda: fuentes
    app.dependency_overrides[obtener_corridas] = lambda: repo
    yield {"cliente": TestClient(app), "fuentes": fuentes, "enviados": enviados, "estado": estado, "repo": repo}
    app.dependency_overrides.clear()


def xml(cliente, metodo, ruta, **kw):
    r = cliente.request(metodo, ruta, headers={"Accept": "application/xml"}, **kw)
    XSD.assertValid(etree.fromstring(r.content))
    return r


def correr(cliente, **cuerpo):
    return cliente.post("/v1/forecast/run", json={"productId": PRODUCTO, "zoneId": ZONA, **cuerpo})


# --- POST /v1/forecast/run

def test_corrida_completa_se_guarda_y_se_relee_igual(entorno):
    c = entorno["cliente"]
    r = correr(c)

    assert r.status_code == 201
    corrida = r.json()
    assert corrida["disponible"] is True and corrida["motivo"] is None
    assert corrida["product"] == {"id": PRODUCTO, "name": "Azúcar estándar", "unit": "kg", "unitType": "masa"}
    assert corrida["zone"] == {"id": ZONA, "name": "Zona Valle"}
    assert corrida["dataVersion"]["weeks"] == 20 and corrida["dataVersion"]["zeroWeeks"] == 0
    assert corrida["validation"]["trainWeeks"] == 16 and corrida["validation"]["mape"] < 0.5
    assert len(corrida["forecast"]) == 8
    assert corrida["parameters"]["publicationRule"] == "ambos"
    assert c.get(f"/v1/forecast/runs/{corrida['id']}").json() == corrida


def test_corrida_en_xml_valida_contra_el_xsd(entorno):
    r = xml(entorno["cliente"], "POST", "/v1/forecast/run", json={"productId": PRODUCTO, "zoneId": ZONA})
    assert r.status_code == 201
    assert b"<forecastRunResponse" in r.content


def test_sin_zona_suma_todas_las_zonas(entorno):
    r = correr(entorno["cliente"], zoneId=None)
    assert r.status_code == 201
    assert r.json()["zone"] is None
    assert entorno["fuentes"].pedidas[-1][1] is None
    xml(entorno["cliente"], "POST", "/v1/forecast/run", json={"productId": PRODUCTO})


def test_la_ventana_se_ajusta_a_semanas_completas(entorno):
    r = correr(entorno["cliente"], dateFrom="2025-07-02", dateTo="2026-11-18")
    assert r.status_code == 201
    _, _, desde, hasta = entorno["fuentes"].pedidas[-1]
    assert (desde.isoformat(), hasta.isoformat()) == ("2025-07-07", "2026-11-15")  # miércoles → lunes / domingo
    assert r.json()["dataVersion"]["effectiveTo"] == "2026-11-15"
    assert r.json()["parameters"]["dateFrom"] == "2025-07-02"  # lo pedido queda en los parámetros


def test_d36_no_disponible_sin_numeros_y_valida_en_xml(entorno):
    entorno["fuentes"].transacciones, entorno["fuentes"].tiendas = 10, 2
    r = correr(entorno["cliente"])

    assert r.status_code == 201
    corrida = r.json()
    assert corrida["disponible"] is False
    assert corrida["motivo"] == "Menos de 3 tiendas con el producto en la zona (D-36)."
    assert corrida["coverage"] == {"transactions": 10, "stores": 2}
    for campo in ("dataVersion", "history", "validation", "forecast", "model"):
        assert campo not in corrida
    assert corrida["limitations"] == []
    xml(entorno["cliente"], "POST", "/v1/forecast/run", json={"productId": PRODUCTO, "zoneId": ZONA})


@pytest.mark.parametrize("semanas, status", [(11, 422), (12, 201)])
def test_frontera_de_historia(entorno, semanas, status):
    entorno["fuentes"].semanas = semanas
    r = correr(entorno["cliente"])
    assert r.status_code == status
    if status == 422:
        assert r.json()["message"] == "Hay 11 semanas de historia; el pronóstico necesita al menos 12 (D-40)."
        assert r.json()["code"] == "VALIDATION_ERROR"
        assert entorno["repo"].listar(None, None, 1, 20)[1] == 0  # un 422 no se guarda
    else:
        assert r.json()["validation"]["trainWeeks"] == 8


def test_tipos_de_unidad_mezclados_dan_422(entorno):
    f = entorno["fuentes"]
    f._presentaciones, f._vendidas = [KG_1, PZA_12], ("kg1", "pza12")
    r = correr(entorno["cliente"])
    assert r.status_code == 422
    assert "tipos de unidad distintos" in r.json()["message"]


def test_ventana_sin_semana_completa_da_422(entorno):
    r = correr(entorno["cliente"], dateFrom="2026-11-04", dateTo="2026-11-06")  # miércoles a viernes
    assert r.status_code == 422
    assert "ninguna semana completa" in r.json()["message"]


@pytest.mark.parametrize("cuerpo, texto", [
    ({"productId": PRODUCTO, "horizonWeeks": 12}, "horizonWeeks"),            # D-40 no se pide
    ({"productId": "no-es-uuid"}, "productId"),
    ({"productId": PRODUCTO, "zoneId": "123"}, "zoneId"),
    ({"productId": PRODUCTO, "dateFrom": "01/07/2026"}, "dateFrom"),
    ({"productId": PRODUCTO, "dateTo": "2026-02-30"}, "dateTo"),
    ({"productId": PRODUCTO, "dateFrom": "2026-11-01", "dateTo": "2026-10-01"}, "posterior"),
    ({}, "productId"),
])
def test_cuerpo_invalido_da_400(entorno, cuerpo, texto):
    r = entorno["cliente"].post("/v1/forecast/run", json=cuerpo)
    assert r.status_code == 400
    assert r.json()["code"] == "VALIDATION_ERROR"
    assert texto in " ".join(r.json()["details"])


def test_producto_inexistente_404_y_catalogo_caido_503_en_xml(entorno):
    entorno["fuentes"].falta = "producto"
    r = xml(entorno["cliente"], "POST", "/v1/forecast/run", json={"productId": PRODUCTO})
    assert r.status_code == 404
    entorno["fuentes"].falta = "catalogo"
    assert xml(entorno["cliente"], "POST", "/v1/forecast/run", json={"productId": PRODUCTO}).status_code == 503


def test_mongo_caido_da_503_y_no_avisa(entorno, monkeypatch):
    def caido(_corrida):
        raise HTTPException(503, "MongoDB no responde: no se pudo guardar la corrida.")

    monkeypatch.setattr(entorno["repo"], "guardar", caido)
    r = correr(entorno["cliente"])
    assert r.status_code == 503
    assert entorno["enviados"] == []


# --- Bitácora, aviso y linaje

def test_corrida_disponible_avisa_a_los_tres_con_token_y_correlacion(entorno):
    r = entorno["cliente"].post("/v1/forecast/run", json={"productId": PRODUCTO, "zoneId": ZONA},
                                headers={"Authorization": "Bearer tok", "X-Correlation-Id": "op-77"})
    corrida = r.json()
    rutas = [e["ruta"] for e in entorno["enviados"]]

    assert rutas == ["/v1/auditoria", "/v1/notifications", "/v1/lineage"]
    for e in entorno["enviados"]:
        assert (e["ctx"].token, e["ctx"].correlacion) == ("Bearer tok", "op-77")
    auditoria, aviso, linaje = (e["cuerpo"] for e in entorno["enviados"])
    assert (auditoria["accion"], auditoria["tabla"], auditoria["registroId"]) == (
        "ejecutar_corrida", "forecast_runs", corrida["id"])
    assert aviso["eventType"] == "corrida.terminada" and aviso["recipientUserId"] == USUARIO
    assert linaje["source"] == {"key": "ventas-core-process", "version": corrida["dataVersion"]["sha256"]}
    assert (linaje["resourceType"], linaje["resourceId"], linaje["occurredAt"]) == (
        "corrida", corrida["id"], corrida["date"])


def test_corrida_no_disponible_no_registra_linaje(entorno):
    entorno["fuentes"].transacciones = 9
    correr(entorno["cliente"])
    assert [e["ruta"] for e in entorno["enviados"]] == ["/v1/auditoria", "/v1/notifications"]


def test_un_422_no_se_reporta(entorno):
    entorno["fuentes"].semanas = 11
    correr(entorno["cliente"])
    assert entorno["enviados"] == []


# --- Permisos (Matriz §3.2)

@pytest.mark.parametrize("rol", TODOS_LOS_ROLES)
def test_permisos_por_rol(entorno, rol):
    c = entorno["cliente"]
    entorno["estado"]["rol"] = ROL.ANALISTA
    id_corrida = correr(c).json()["id"]
    entorno["estado"]["rol"] = rol

    lanza = 201 if rol == ROL.ANALISTA else 403
    lee = 200 if rol in PERFILES_INTERNOS else 403
    assert correr(c).status_code == lanza
    assert c.post(f"/v1/forecast/runs/{id_corrida}/replay").status_code == (200 if lanza == 201 else 403)
    assert c.get("/v1/forecast/runs").status_code == lee
    assert c.get(f"/v1/forecast/runs/{id_corrida}").status_code == lee


def test_sin_sesion_401(entorno):
    app.dependency_overrides.pop(sesion_actual)
    r = xml(entorno["cliente"], "GET", "/v1/forecast/runs")
    assert r.status_code == 401


# --- GET /v1/forecast/runs y /:id

def test_listado_filtrado_paginado_y_en_xml(entorno):
    c = entorno["cliente"]
    correr(c)
    entorno["fuentes"].transacciones = 9
    no_disponible = correr(c).json()

    r = c.get("/v1/forecast/runs", params={"productId": PRODUCTO, "limit": 1})
    assert r.status_code == 200
    cuerpo = r.json()
    assert (cuerpo["total"], cuerpo["page"], cuerpo["limit"]) == (2, 1, 1)
    assert cuerpo["data"][0]["id"] == no_disponible["id"]
    assert (cuerpo["data"][0]["weeks"], cuerpo["data"][0]["mape"]) == (None, None)
    assert xml(c, "GET", "/v1/forecast/runs").status_code == 200


@pytest.mark.parametrize("params", [{"productId": "x"}, {"zoneId": "x"}, {"page": 0}, {"limit": 0}])
def test_listado_con_query_invalida_da_400(entorno, params):
    assert entorno["cliente"].get("/v1/forecast/runs", params=params).status_code == 400


def test_detalle_en_xml_y_errores_400_404(entorno):
    c = entorno["cliente"]
    corrida = correr(c).json()
    assert xml(c, "GET", f"/v1/forecast/runs/{corrida['id']}").status_code == 200
    assert xml(c, "GET", "/v1/forecast/runs/no-es-id").status_code == 400
    assert xml(c, "GET", "/v1/forecast/runs/674a1f3c9e2b4d0012ab34cd").status_code == 404


# --- POST /v1/forecast/runs/:id/replay

def test_replay_identico_en_json_y_xml(entorno):
    c = entorno["cliente"]
    corrida = correr(c).json()
    r = c.post(f"/v1/forecast/runs/{corrida['id']}/replay")

    assert r.status_code == 200
    assert r.json() | {"durationMs": 0} == {"runId": corrida["id"], "identical": True,
                                           "sha256": corrida["dataVersion"]["sha256"], "differences": [],
                                           "durationMs": 0}
    r = xml(c, "POST", f"/v1/forecast/runs/{corrida['id']}/replay")
    assert b"<forecastReplayResponse" in r.content
    assert entorno["enviados"][-1]["cuerpo"]["cambios"][0]["posterior"] == "repeticion"


def test_replay_detecta_diferencias_hoja_por_hoja(entorno):
    c = entorno["cliente"]
    corrida = correr(c).json()
    coleccion = entorno["repo"]._coleccion
    from bson import ObjectId
    coleccion.update_one({"_id": ObjectId(corrida["id"])},
                         {"$set": {"forecast.3.lower95": -1.0, "model.library": "statsmodels 0.13.0"}})

    r = c.post(f"/v1/forecast/runs/{corrida['id']}/replay").json()
    assert r["identical"] is False
    assert {d["field"] for d in r["differences"]} == {"forecast[3].lower95", "model.library"}
    xml(c, "POST", f"/v1/forecast/runs/{corrida['id']}/replay")


def test_replay_de_corrida_no_disponible_da_409(entorno):
    entorno["fuentes"].transacciones = 9
    corrida = correr(entorno["cliente"]).json()
    r = xml(entorno["cliente"], "POST", f"/v1/forecast/runs/{corrida['id']}/replay")
    assert r.status_code == 409
    assert entorno["cliente"].post("/v1/forecast/runs/674a1f3c9e2b4d0012ab34cd/replay").status_code == 404


# --- Swagger

def test_swagger_trae_ejemplos_json_y_xml_validos():
    rutas = TestClient(app).get("/openapi.json").json()["paths"]
    for ruta, metodo, status in [("/v1/forecast/run", "post", "201"), ("/v1/forecast/runs", "get", "200"),
                                 ("/v1/forecast/runs/{id_corrida}", "get", "200"),
                                 ("/v1/forecast/runs/{id_corrida}/replay", "post", "200")]:
        contenido = rutas[ruta][metodo]["responses"][status]["content"]
        assert "example" in contenido["application/json"]
        XSD.assertValid(etree.fromstring(contenido["application/xml"]["example"].encode()))
        for error in ("401", "403"):
            XSD.assertValid(etree.fromstring(
                rutas[ruta][metodo]["responses"][error]["content"]["application/xml"]["example"].encode()))
