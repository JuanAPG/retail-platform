"""Lo propio del servicio sobre la plantilla: nombre, health sin Postgres y con
MongoDB (D-47), y la configuración de despliegue (puerto 3116, variables)."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

RAIZ = Path(__file__).resolve().parents[1]


@pytest.fixture()
def cliente():
    return TestClient(app)


def test_health_sin_postgres_y_con_mongo(cliente, monkeypatch):
    # Sin MongoDB arriba: el check falla rápido (2 s) y degrada, pero responde 200 (D-25).
    monkeypatch.setenv("MONGO_URL", "mongodb://127.0.0.1:1/retaildb?serverSelectionTimeoutMS=200")
    r = cliente.get("/v1/health")

    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["service"] == "demand-forecast-service"
    assert cuerpo["checks"]["postgres"] == "no configurado"  # no lee ni escribe tablas
    assert cuerpo["checks"]["mongodb"].startswith("error")
    assert cuerpo["status"] == "degraded"


def test_health_sin_mongo_configurado_no_degrada_por_mongo(cliente, monkeypatch):
    monkeypatch.delenv("MONGO_URL", raising=False)
    cuerpo = cliente.get("/v1/health").json()

    assert cuerpo["checks"]["mongodb"] == "no configurado"
    assert cuerpo["checks"]["postgres"] == "no configurado"


def test_health_en_xml_lleva_el_namespace_del_servicio(cliente):
    r = cliente.get("/v1/health", headers={"Accept": "application/xml"})

    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/xml")
    assert 'xmlns="forecast/v1"' in r.text


def test_cors_para_la_web_local(cliente):
    r = cliente.options("/v1/health", headers={"Origin": "http://localhost:5173",
                                               "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"


def test_puerto_y_variables_de_despliegue():
    dockerfile = (RAIZ / "Dockerfile").read_text(encoding="utf-8")
    assert "ENV PORT=3116" in dockerfile and "EXPOSE 3116" in dockerfile

    variables = {linea.split("=", 1)[0] for linea in (RAIZ / ".env.example").read_text(encoding="utf-8").splitlines()
                 if "=" in linea and not linea.startswith("#")}
    obligatorias = {"PORT", "SERVICE_NAME", "XML_NAMESPACE", "JWT_ACCESS_SECRET", "REDIS_HOST", "REDIS_PORT",
                    "MONGO_URL", "CATALOG_SERVICE_URL", "CORE_PROCESS_SERVICE_URL", "AUDIT_SERVICE_URL",
                    "NOTIFICATIONS_SERVICE_URL", "DATA_GOVERNANCE_SERVICE_URL", "SEASONAL_PERIOD",
                    "PUBLICATION_RULE"}
    assert obligatorias <= variables
    assert not {"DB_HOST", "DB_USER", "DB_PASSWORD"} & variables  # sin PostgreSQL
