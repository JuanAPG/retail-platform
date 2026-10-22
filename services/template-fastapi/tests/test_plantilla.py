"""Pruebas de lo transversal de la plantilla (T-02): id de correlación y health.

    pip install -r requirements-dev.txt
    python -m pytest
"""
import json
import logging
import re

import pytest
from fastapi.testclient import TestClient

from app.correlacion import con_correlacion, correlacion_actual, id_de_correlacion
from app.main import app, armar_salud

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


@app.get("/v1/_prueba/correlacion")
def _ruta_de_prueba():
    """Solo para estas pruebas: deja ver qué id ve un handler y qué reenviaría."""
    return {"actual": correlacion_actual(), "reenvio": con_correlacion({"Accept": "application/json"})}


@pytest.fixture()
def cliente():
    return TestClient(app)


@pytest.mark.parametrize("entrante", [None, "", "abc\ninyectado", "x" * 101, "../../etc"])
def test_id_invalido_o_ausente_se_reemplaza(entrante):
    assert UUID.match(id_de_correlacion(entrante))


def test_id_valido_se_respeta():
    assert id_de_correlacion("movil-7f3a:01") == "movil-7f3a:01"


def test_el_handler_ve_el_id_y_lo_reenvia(cliente):
    r = cliente.get("/v1/_prueba/correlacion", headers={"X-Correlation-Id": "op-123"})

    assert r.headers["x-correlation-id"] == "op-123"
    assert r.json() == {"actual": "op-123", "reenvio": {"Accept": "application/json", "x-correlation-id": "op-123"}}


def test_sin_cabecera_se_genera_y_se_devuelve(cliente):
    r = cliente.get("/v1/_prueba/correlacion")

    assert UUID.match(r.headers["x-correlation-id"])
    assert r.json()["actual"] == r.headers["x-correlation-id"]


def test_fuera_de_una_peticion_no_hay_id():
    assert correlacion_actual() is None
    assert con_correlacion({"A": "b"}) == {"A": "b"}


def test_un_error_tambien_lleva_su_id(cliente):
    r = cliente.get("/v1/no-existe", headers={"X-Correlation-Id": "op-404"})

    assert r.status_code == 404
    assert r.headers["x-correlation-id"] == "op-404"


def test_la_respuesta_xml_conserva_los_ids(cliente):
    r = cliente.get("/v1/health", headers={"Accept": "application/xml", "X-Correlation-Id": "op-xml"})

    assert r.headers["content-type"].startswith("application/xml")
    assert r.headers["x-correlation-id"] == "op-xml"
    assert "x-request-id" in r.headers


def test_el_log_trae_el_id(cliente, caplog):
    with caplog.at_level(logging.INFO, logger="http"):
        cliente.get("/v1/health", headers={"X-Correlation-Id": "op-log"})

    lineas = [json.loads(r.getMessage()) for r in caplog.records if r.name == "http"]
    assert lineas[-1]["correlationId"] == "op-log"
    assert lineas[-1]["path"] == "/v1/health"


def test_health_reporta_las_tres_dependencias_con_latencia(cliente, monkeypatch):
    # Sin Redis en la prueba: sale como error y degrada; Postgres y Mongo no
    # están configurados (sin driver o sin MONGO_URL) y NO degradan.
    monkeypatch.delenv("MONGO_URL", raising=False)
    cuerpo = cliente.get("/v1/health").json()

    assert set(cuerpo["checks"]) == {"postgres", "mongodb", "redis"}
    assert cuerpo["checks"]["mongodb"] == "no configurado"
    assert set(cuerpo["latencyMs"]) == {"postgres", "mongodb", "redis"}
    assert isinstance(cuerpo["durationMs"], int)


def test_no_configurado_no_degrada_y_error_si():
    assert armar_salud({"a": lambda: "ok", "b": lambda: "no configurado"})["status"] == "ok"
    assert armar_salud({"a": lambda: "ok", "b": lambda: "error: caído"})["status"] == "degraded"


def test_un_check_que_lanza_no_tumba_el_health():
    def revienta():
        raise RuntimeError("ECONNREFUSED")

    salud = armar_salud({"redis": revienta})

    assert salud["status"] == "degraded"
    assert salud["checks"]["redis"] == "error: ECONNREFUSED"


def test_los_checks_corren_en_paralelo():
    import time

    def tarda():
        time.sleep(0.2)
        return "ok"

    inicio = time.monotonic()
    armar_salud({"a": tarda, "b": tarda, "c": tarda})

    assert time.monotonic() - inicio < 0.5
