"""STA-03 por HTTP: correr, guardar en Mongo y recuperar una corrida; roles
(D-24), Mongo caído → 503 (D-25), límites (D-27) y XML contra el XSD.

Mongo se simula con mongomock (mismo API de pymongo) y catalog/core-process
con `httpx.MockTransport`. El 503 usa pymongo de verdad contra un puerto cerrado.
"""
import pathlib
import uuid

import httpx
import mongomock
import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.auth_session import sesion_actual
from app.corridas import Corridas, obtener_corridas
from app.fuentes import Fuentes, obtener_fuentes
from app.main import app
from app.roles import ROL

XSD = pathlib.Path(__file__).resolve().parents[3] / "docs" / "contratos" / "analytics-stats.xsd"
TOKEN = "Bearer token-del-analista"
VALLE, CENTRO, ORIENTE, NORTE = (str(uuid.UUID(int=n)) for n in (1, 2, 3, 4))

INDICADORES = {
    VALLE: ("Zona Valle", 65000, 85000, 0.95),
    CENTRO: ("Zona Centro", 28000, 120000, 0.85),
    ORIENTE: ("Zona Oriente", 12000, 150000, 0.65),
    NORTE: ("Zona Norte", 30000, 90000, 0.8),
}
TICKET = {VALLE: 143.2, CENTRO: 96.4, ORIENTE: 73.6, NORTE: 0}  # Norte sin canastas: core-process responde 0.
EN_CUERPO = {"k": 2, "features": ["estimatedIncome", "averageTicket"], "zones": [
    {"zoneId": "z-1", "zoneName": "Zona Valle", "estimatedIncome": 65000, "averageTicket": 143.2},
    {"zoneId": "z-2", "zoneName": "Zona Centro", "estimatedIncome": 28000, "averageTicket": 96.4},
    {"zoneId": "z-3", "zoneName": "Zona Oriente", "estimatedIncome": 12000, "averageTicket": 73.6},
]}


class Servicios:
    """catalog y core-process falsos para el clustering."""

    def __init__(self, zonas=(VALLE, CENTRO, ORIENTE)):
        self.zonas = list(zonas)
        self.peticiones: list[httpx.Request] = []

    def __call__(self, peticion: httpx.Request) -> httpx.Response:
        self.peticiones.append(peticion)
        ruta, params = peticion.url.path, peticion.url.params
        if ruta == "/v1/zones":
            pagina, limite = int(params["page"]), int(params["limit"])
            datos = [{"id": z, "nombre": INDICADORES[z][0], "activo": True} for z in self.zonas]
            return httpx.Response(200, json={"data": datos[(pagina - 1) * limite: pagina * limite],
                                             "total": len(datos), "page": pagina, "limit": limite})
        if ruta == "/v1/zones/compare":
            ids = params["ids"].split(",")
            faltan = [i for i in ids if i not in INDICADORES]
            if faltan:
                return httpx.Response(404, json={"message": f"No existen las zonas: {', '.join(faltan)}."})
            return httpx.Response(200, json=[
                {"zoneId": i, "zoneName": INDICADORES[i][0], "municipality": "x", "classification": None,
                 "estimatedIncome": INDICADORES[i][1], "population": INDICADORES[i][2],
                 "availability": INDICADORES[i][3]} for i in ids])
        assert ruta == "/v1/analytics/average-ticket", ruta
        return httpx.Response(200, json=TICKET[params["zoneId"]])

    def a(self, ruta: str) -> list[httpx.Request]:
        return [p for p in self.peticiones if p.url.path == ruta]


@pytest.fixture
def mongo():
    cliente = mongomock.MongoClient("mongodb://localhost:27017/retaildb", tz_aware=True)
    app.dependency_overrides[obtener_corridas] = lambda: Corridas(cliente)
    yield cliente.get_default_database()["analysis_runs"]
    app.dependency_overrides.clear()


def cliente(rol: str = ROL.ANALISTA, servicios: Servicios | None = None) -> TestClient:
    servicios = servicios or Servicios()

    def fuentes_falsas(request: Request):
        with httpx.Client(transport=httpx.MockTransport(servicios)) as http:
            yield Fuentes(request.headers.get("authorization"), http)

    app.dependency_overrides[sesion_actual] = lambda: {"id": f"id-de-{rol}", "rol": rol}
    app.dependency_overrides[obtener_fuentes] = fuentes_falsas
    return TestClient(app, headers={"Authorization": TOKEN})


def test_corre_guarda_y_se_recupera_igual_por_su_id(mongo):
    analista = cliente()

    creada = analista.post("/v1/clustering/run", json=EN_CUERPO)

    assert creada.status_code == 201, creada.text
    corrida = creada.json()
    assert corrida["parameters"] == {"k": 2, "seed": 42, "features": ["estimatedIncome", "averageTicket"],
                                     "source": "cuerpo", "zoneIds": None, "dateFrom": None, "dateTo": None}
    assert corrida["userId"] == f"id-de-{ROL.ANALISTA}" and "user" not in corrida  # D-26
    # QA STA-03: recuperarla por id da las mismas asignaciones.
    leida = analista.get(f"/v1/clustering/runs/{corrida['id']}")
    assert leida.status_code == 200
    assert leida.json() == corrida
    # En Mongo: la corrida completa, con su entrada (foto de D-15) y solo el userId.
    documento = mongo.find_one()
    assert documento["type"] == "clustering" and len(documento["input"]) == 3
    assert "userId_date" in mongo.index_information()


def test_con_los_servicios_lee_indicadores_y_ticket(mongo):
    servicios = Servicios(zonas=(VALLE, CENTRO, ORIENTE, NORTE))

    r = cliente(servicios=servicios).post("/v1/clustering/run",
                                          json={"k": 2, "dateFrom": "2026-08-01", "dateTo": "2026-09-30"})

    assert r.status_code == 201, r.text
    corrida = r.json()
    assert corrida["parameters"]["source"] == "servicios"
    # Norte: core-process da ticket 0 (sin canastas). No es un valor: se excluye (D-20).
    assert corrida["excludedZones"] == [{"zoneId": NORTE, "zoneName": "Zona Norte",
                                         "reason": "Sin ticket promedio: no se rellena con 0 (D-20)."}]
    assert {a["zoneId"] for a in corrida["assignments"]} == {VALLE, CENTRO, ORIENTE}
    assert [z["averageTicket"] for z in corrida["input"] if z["zoneId"] == VALLE] == [143.2]
    compare = servicios.a("/v1/zones/compare")
    assert len(compare) == 1 and set(compare[0].url.params["ids"].split(",")) == {VALLE, CENTRO, ORIENTE, NORTE}
    tickets = servicios.a("/v1/analytics/average-ticket")
    assert len(tickets) == 4 and all(p.url.params["dateFrom"] == "2026-08-01" for p in tickets)
    assert all(p.headers["authorization"] == TOKEN for p in servicios.peticiones)


def test_sin_ticket_en_features_no_lo_pide_y_con_zone_ids_no_lista_zonas(mongo):
    servicios = Servicios()

    r = cliente(servicios=servicios).post("/v1/clustering/run", json={
        "k": 2, "features": ["estimatedIncome", "population"], "zoneIds": [VALLE, CENTRO, ORIENTE]})

    assert r.status_code == 201, r.text
    assert servicios.a("/v1/analytics/average-ticket") == [] and servicios.a("/v1/zones") == []
    assert r.json()["parameters"]["zoneIds"] == [VALLE, CENTRO, ORIENTE]


def test_zona_inexistente_en_catalog_es_404(mongo):
    r = cliente().post("/v1/clustering/run", json={"k": 2, "zoneIds": [VALLE, CENTRO, str(uuid.UUID(int=99))]})

    assert r.status_code == 404
    assert "No existen las zonas" in r.json()["message"]
    assert mongo.count_documents({}) == 0


def test_k_3_con_3_zonas_es_400_d27_y_no_guarda(mongo):
    r = cliente().post("/v1/clustering/run", json={"k": 3})

    assert r.status_code == 400
    assert r.json()["message"] == ("k debe ser menor que el número de zonas con datos (3): "
                                   "con estos datos solo se puede k = 2 (D-27).")
    assert mongo.count_documents({}) == 0


@pytest.mark.parametrize("cuerpo,mensaje", [
    ({**EN_CUERPO, "zoneIds": [VALLE, CENTRO, ORIENTE]}, "no van zoneIds ni fechas"),
    ({**EN_CUERPO, "dateFrom": "2026-08-01"}, "no van zoneIds ni fechas"),
    ({"k": 2, "features": ["population", "population"]}, "sin repetir"),
    ({"k": 2, "features": []}, "de 1 a 4"),
    ({"k": 2, "features": ["ingreso"]}, "features.0"),
    ({"k": 1}, "k:"),
    ({"k": 11}, "k:"),
    ({"k": 2, "seed": -1}, "seed:"),
    ({"k": 2, "zoneIds": [VALLE, CENTRO]}, "al menos 3 zonas"),
    ({"k": 2, "zoneIds": [VALLE, VALLE, CENTRO]}, "no puede repetir"),
    ({**EN_CUERPO, "zones": EN_CUERPO["zones"] + [EN_CUERPO["zones"][0]]}, "no puede repetir zoneId"),
    ({"k": 2, "dateFrom": "2026-02-30"}, "dateFrom debe ser un día"),
    ({"k": 2, "extra": True}, "extra:"),
])
def test_peticiones_invalidas_son_400(mongo, cuerpo, mensaje):
    servicios = Servicios()

    r = cliente(servicios=servicios).post("/v1/clustering/run", json=cuerpo)

    assert r.status_code == 400
    assert any(mensaje in d for d in r.json()["details"]), r.json()["details"]
    assert servicios.peticiones == [] and mongo.count_documents({}) == 0


@pytest.mark.parametrize("rol", [ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA, ROL.RESPONSABLE_PRECIOS,
                                 ROL.PLANEADOR, ROL.AUDITOR, ROL.PROVEEDOR])
def test_solo_el_analista_corre_d24(mongo, rol):
    assert cliente(rol).post("/v1/clustering/run", json=EN_CUERPO).status_code == 403
    assert mongo.count_documents({}) == 0


@pytest.mark.parametrize("rol,estado", [(ROL.ADMINISTRADOR, 200), (ROL.ANALISTA, 200), (ROL.GERENTE_CATEGORIA, 200),
                                        (ROL.RESPONSABLE_PRECIOS, 200), (ROL.PLANEADOR, 200), (ROL.AUDITOR, 200),
                                        (ROL.PROVEEDOR, 403)])
def test_las_corridas_las_leen_los_internos_d24(mongo, rol, estado):
    creada = cliente().post("/v1/clustering/run", json=EN_CUERPO).json()

    lector = cliente(rol)
    assert lector.get("/v1/clustering/runs").status_code == estado
    assert lector.get(f"/v1/clustering/runs/{creada['id']}").status_code == estado


def test_sin_token_es_401():
    app.dependency_overrides.clear()
    sin_sesion = TestClient(app)

    assert sin_sesion.post("/v1/clustering/run", json=EN_CUERPO).status_code == 401
    assert sin_sesion.get("/v1/clustering/runs").status_code == 401


def test_listado_paginado_de_la_mas_reciente_sin_la_entrada(mongo):
    analista = cliente()
    ids = [analista.post("/v1/clustering/run", json={**EN_CUERPO, "seed": s}).json()["id"] for s in (1, 2, 3)]

    pagina = analista.get("/v1/clustering/runs?page=1&limit=2").json()
    siguiente = analista.get("/v1/clustering/runs?page=2&limit=2").json()

    assert pagina["total"] == 3 and (pagina["page"], pagina["limit"]) == (1, 2)
    assert [c["id"] for c in pagina["data"] + siguiente["data"]] == ids[::-1]
    resumen = pagina["data"][0]
    assert resumen["zoneCount"] == 3
    assert not {"input", "clusters", "assignments", "excludedZones", "assumptions"} & set(resumen)
    assert analista.get("/v1/clustering/runs?page=0").status_code == 400
    assert analista.get("/v1/clustering/runs?limit=500").json()["limit"] == 100


def test_id_mal_formado_400_e_inexistente_404(mongo):
    analista = cliente()

    assert analista.get("/v1/clustering/runs/abc").status_code == 400
    r = analista.get("/v1/clustering/runs/6713f0c2e4b0a1b2c3d4e5f6")
    assert r.status_code == 404 and r.json()["message"] == "No existe la corrida de clustering 6713f0c2e4b0a1b2c3d4e5f6."


def test_mongo_caido_es_503_d25():
    # pymongo de verdad contra un puerto cerrado: falla rápido y responde 503, no 500.
    caido = MongoClient("mongodb://127.0.0.1:1/retaildb", serverSelectionTimeoutMS=300, connectTimeoutMS=300)
    app.dependency_overrides[obtener_corridas] = lambda: Corridas(caido)
    analista = cliente()

    for respuesta in (analista.post("/v1/clustering/run", json=EN_CUERPO),
                      analista.get("/v1/clustering/runs"),
                      analista.get("/v1/clustering/runs/6713f0c2e4b0a1b2c3d4e5f6")):
        assert respuesta.status_code == 503
        assert respuesta.json()["code"] == "SERVICE_UNAVAILABLE"
        assert respuesta.json()["message"].startswith("MongoDB no responde")
    app.dependency_overrides.clear()


@pytest.fixture(scope="module")
def esquema():
    xmlschema = pytest.importorskip("xmlschema")
    if not XSD.exists():
        pytest.skip("Sin el XSD del contrato: corre las pruebas desde el repo completo.")
    return xmlschema.XMLSchema(str(XSD))


def test_xml_de_las_tres_rutas_valida_contra_el_xsd(mongo, esquema):
    analista = cliente()
    xml = {"Accept": "application/xml"}
    servicios = Servicios(zonas=(VALLE, CENTRO, ORIENTE, NORTE))

    creada = cliente(servicios=servicios).post("/v1/clustering/run", json={"k": 2}, headers=xml)
    assert creada.status_code == 201
    esquema.validate(creada.text)
    assert creada.text.count("<excludedZones><item>") == 1
    id_corrida = analista.get("/v1/clustering/runs").json()["data"][0]["id"]
    esquema.validate(analista.get("/v1/clustering/runs", headers=xml).text)
    esquema.validate(analista.get(f"/v1/clustering/runs/{id_corrida}", headers=xml).text)
    esquema.validate(analista.get("/v1/clustering/runs/abc", headers=xml).text)


@pytest.mark.parametrize("ruta,metodo,estado", [
    ("/v1/clustering/run", "post", "201"),
    ("/v1/clustering/runs", "get", "200"),
    ("/v1/clustering/runs/{id_corrida}", "get", "200"),
])
def test_swagger_documenta_ejemplo_json_y_xml(ruta, metodo, estado, esquema):
    operacion = TestClient(app).get("/openapi.json").json()["paths"][ruta][metodo]

    contenido = operacion["responses"][estado]["content"]
    assert contenido["application/json"]["example"]
    esquema.validate(contenido["application/xml"]["example"])
    for codigo, respuesta in operacion["responses"].items():
        # FastAPI documenta solo un 422 que nunca sale: el manejador lo vuelve 400.
        if codigo.startswith(("4", "5")) and codigo != "422":
            esquema.validate(respuesta["content"]["application/xml"]["example"])
