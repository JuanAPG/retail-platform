"""STA-04: bitácora y aviso de cada análisis, de fondo y sin cambiar nunca la
respuesta. audit-service y notifications-service se simulan con
`httpx.MockTransport`; Mongo con mongomock."""
import json

import httpx
import mongomock
import pytest
from fastapi.testclient import TestClient

from app import reportes
from app.auth_session import sesion_actual
from app.corridas import Corridas, obtener_corridas
from app.main import app
from app.roles import ROL

TOKEN = "Bearer token-del-analista"
ANALISTA = {"id": "11111111-1111-4111-8111-111111111111", "rol": ROL.ANALISTA}
HIPOTESIS = {"groups": [{"label": "Ingreso alto", "values": [142, 170.5, 98, 120, 155.5, 133, 160, 149.5]},
                        {"label": "Ingreso bajo", "values": [108, 36, 72, 55.5, 90, 61, 80.5, 47]}]}
CLUSTERING = {"k": 2, "features": ["estimatedIncome"], "zones": [
    {"zoneId": "z-1", "estimatedIncome": 65000}, {"zoneId": "z-2", "estimatedIncome": 28000},
    {"zoneId": "z-3", "estimatedIncome": 12000}, {"zoneId": "z-4", "estimatedIncome": None}]}


class Receptores:
    """audit y notifications falsos: guardan lo que les llega."""

    def __init__(self, falla: Exception | None = None, estado: int = 201):
        self.falla, self.estado = falla, estado
        self.recibidos: list[httpx.Request] = []

    def __call__(self, peticion: httpx.Request) -> httpx.Response:
        self.recibidos.append(peticion)
        if self.falla:
            raise self.falla
        return httpx.Response(self.estado, json={})

    def cuerpos(self, ruta: str) -> list[dict]:
        return [json.loads(p.content) for p in self.recibidos if p.url.path == ruta]


@pytest.fixture
def receptores(monkeypatch):
    def preparar(**kwargs) -> Receptores:
        receptor = Receptores(**kwargs)
        monkeypatch.setenv("AUDIT_SERVICE_URL", "http://audit-service:3110")
        monkeypatch.setenv("NOTIFICATIONS_SERVICE_URL", "http://notifications-service:3109")
        monkeypatch.setattr(reportes, "_cliente", lambda: httpx.Client(transport=httpx.MockTransport(receptor),
                                                                        timeout=reportes.LIMITE_S))
        return receptor
    yield preparar
    app.dependency_overrides.clear()


def analista() -> TestClient:
    app.dependency_overrides[sesion_actual] = lambda: ANALISTA
    cliente_mongo = mongomock.MongoClient("mongodb://localhost:27017/retaildb", tz_aware=True)
    app.dependency_overrides[obtener_corridas] = lambda: Corridas(cliente_mongo)
    return TestClient(app, headers={"Authorization": TOKEN})


@pytest.mark.parametrize("ruta,cuerpo,tipo", [
    ("/v1/hypothesis/test", HIPOTESIS, "hipotesis"),
    ("/v1/anova", {"groups": HIPOTESIS["groups"] + [{"label": "Ingreso medio", "values": [99, 101, 97, 103]}]}, "anova"),
    ("/v1/proportions/compare", {"groups": [{"label": "A", "successes": 30, "total": 42},
                                            {"label": "B", "successes": 12, "total": 30}]}, "proporciones"),
])
def test_cada_prueba_deja_su_bitacora_y_no_avisa(receptores, ruta, cuerpo, tipo):
    receptor = receptores()

    r = analista().post(ruta, json=cuerpo)

    assert r.status_code == 200
    [evento] = receptor.cuerpos("/v1/auditoria")
    assert evento["servicio"] == "analytics-stats" and evento["accion"] == "ejecutar_corrida"
    assert evento["tabla"] == "analisis_estadistico" and evento["registroId"] is None
    assert {c["campo"]: c["posterior"] for c in evento["cambios"]}["tipo"] == tipo
    assert r.json()["conclusion"] in evento["descripcion"]
    assert receptor.cuerpos("/v1/notifications") == []
    assert all(p.headers["authorization"] == TOKEN for p in receptor.recibidos)


def test_el_clustering_deja_bitacora_y_avisa_a_quien_lo_corrio(receptores):
    receptor = receptores()

    r = analista().post("/v1/clustering/run", json=CLUSTERING)

    assert r.status_code == 201
    corrida = r.json()
    [evento] = receptor.cuerpos("/v1/auditoria")
    assert (evento["tabla"], evento["registroId"]) == ("analysis_runs", corrida["id"])
    assert evento["descripcion"] == ("Clustering completada: 3 zona(s) en 2 grupos; "
                                     "1 sin datos completos quedaron fuera.")
    [aviso] = receptor.cuerpos("/v1/notifications")
    assert aviso == {"eventType": "corrida.terminada", "sourceService": "analytics-stats",
                     "relatedEntityType": "corrida", "relatedEntityId": corrida["id"],
                     "recipientUserId": ANALISTA["id"], "title": "Clustering: corrida terminada",
                     "message": "3 zona(s) en 2 grupos; 1 sin datos completos quedaron fuera.", "priority": "info"}
    assert all(p.headers["authorization"] == TOKEN for p in receptor.recibidos)


def test_la_ip_que_no_es_ip_va_nula():
    # El TestClient llega como "testclient": audit-service (columna INET) rechazaría el evento.
    class Peticion:
        client = type("Cliente", (), {"host": "testclient"})()
        headers = {"authorization": TOKEN}

    assert reportes.contexto(Peticion()) == (TOKEN, None)
    Peticion.client.host = "172.18.0.1"
    assert reportes.contexto(Peticion()) == (TOKEN, "172.18.0.1")


@pytest.mark.parametrize("falla,estado", [
    (httpx.ConnectError("caído"), 201),
    (httpx.ReadTimeout("lento"), 201),
    (None, 500),
    (None, 400),
])
def test_audit_o_notifications_caidos_no_cambian_la_respuesta(receptores, falla, estado):
    receptores(falla=falla, estado=estado)
    cliente = analista()

    prueba = cliente.post("/v1/hypothesis/test", json=HIPOTESIS)
    corrida = cliente.post("/v1/clustering/run", json=CLUSTERING)

    assert prueba.status_code == 200 and prueba.json()["test"] == "welch"
    assert corrida.status_code == 201 and len(corrida.json()["assignments"]) == 3


@pytest.mark.parametrize("falla", [httpx.ConnectError("caído"), httpx.ReadTimeout("lento"), httpx.RemoteProtocolError("x")])
def test_los_reportes_se_tragan_sus_errores(receptores, falla, caplog):
    # De fondo, un error ya no cambiaría la respuesta, pero quedaría sin manejar:
    # cada reporte lo deja en el log y sigue.
    receptores(falla=falla)
    corrida = {"id": "6713f0c2e4b0a1b2c3d4e5f6", "userId": ANALISTA["id"], "parameters": {"k": 2},
               "assignments": [{}, {}, {}], "excludedZones": []}
    resultado = {"test": "welch", "rejectNull": True, "conclusion": "x", "pValue": 0.01}

    reportes.clustering_terminado(corrida, TOKEN, None)
    reportes.prueba_terminada("hipotesis", resultado, TOKEN, None)

    assert sum("no reportada" in m for m in caplog.messages) == 3


def test_un_400_no_se_reporta(receptores):
    receptor = receptores()

    assert analista().post("/v1/clustering/run", json={**CLUSTERING, "k": 3}).status_code == 400
    assert analista().post("/v1/hypothesis/test", json={"groups": []}).status_code == 400
    assert receptor.recibidos == []


def test_sin_las_urls_no_se_llama_a_nadie(monkeypatch):
    monkeypatch.delenv("AUDIT_SERVICE_URL", raising=False)
    monkeypatch.delenv("NOTIFICATIONS_SERVICE_URL", raising=False)
    llamadas = []
    monkeypatch.setattr(reportes, "_cliente", lambda: llamadas.append(1))

    assert analista().post("/v1/hypothesis/test", json=HIPOTESIS).status_code == 200
    assert llamadas == []
    app.dependency_overrides.clear()


def test_el_limite_es_de_1_5_s():
    assert reportes.LIMITE_S == 1.5
    with reportes._cliente() as cliente:
        assert cliente.timeout.read == 1.5 and cliente.timeout.connect == 1.5
