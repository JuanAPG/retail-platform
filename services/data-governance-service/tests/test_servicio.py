"""Lo propio del servicio sobre la plantilla: nombre, health con PostgreSQL (tablas propias, D-47)
y Redis, sin MongoDB, y la configuración de despliegue (puerto 3119, variables)."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

RAIZ = Path(__file__).resolve().parents[1]


@pytest.fixture()
def cliente():
    return TestClient(app)


def test_health_con_postgres_y_redis_sin_mongo(cliente, monkeypatch):
    # Postgres y Redis apagados en la prueba: fallan rápido y degradan, pero responde 200 (D-25).
    monkeypatch.setenv("DB_HOST", "127.0.0.1")
    monkeypatch.setenv("DB_PORT", "1")
    monkeypatch.setenv("MONGO_URL", "mongodb://127.0.0.1:1/retaildb")  # sin driver: no lo usa
    r = cliente.get("/v1/health")

    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["service"] == "data-governance-service"
    assert cuerpo["checks"]["postgres"].startswith("error")  # tiene driver: sí lo revisa
    assert cuerpo["checks"]["mongodb"] == "no configurado"
    assert cuerpo["status"] == "degraded"


def test_health_en_xml_lleva_el_namespace_del_servicio(cliente):
    r = cliente.get("/v1/health", headers={"Accept": "application/xml"})

    assert r.status_code == 200
    assert 'xmlns="governance/v1"' in r.text


def test_cors_para_la_web_local(cliente):
    r = cliente.options("/v1/health", headers={"Origin": "http://localhost:5173",
                                               "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"


def test_puerto_y_variables_de_despliegue():
    dockerfile = (RAIZ / "Dockerfile").read_text(encoding="utf-8")
    assert "ENV PORT=3119" in dockerfile and "EXPOSE 3119" in dockerfile

    variables = {linea.split("=", 1)[0] for linea in (RAIZ / ".env.example").read_text(encoding="utf-8").splitlines()
                 if "=" in linea and not linea.startswith("#")}
    obligatorias = {"PORT", "SERVICE_NAME", "XML_NAMESPACE", "JWT_ACCESS_SECRET", "REDIS_HOST", "REDIS_PORT",
                    "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME", "INGESTION_SERVICE_URL",
                    "CORE_PROCESS_SERVICE_URL", "AVAILABILITY_SERVICE_URL", "INCOME_SEGMENTATION_SERVICE_URL",
                    "AUDIT_SERVICE_URL", "FRESHNESS_SALES_DAYS", "FRESHNESS_SEGMENTS_DAYS"}
    assert obligatorias <= variables
    assert "MONGO_URL" not in variables
