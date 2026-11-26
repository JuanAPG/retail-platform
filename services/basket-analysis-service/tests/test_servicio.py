"""Lo propio del servicio sobre la plantilla: nombre, health solo con Redis (no guarda nada:
sin Postgres ni Mongo) y la configuración de despliegue (puerto 3113, variables)."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

RAIZ = Path(__file__).resolve().parents[1]


@pytest.fixture()
def cliente():
    return TestClient(app)


def test_health_solo_depende_de_redis(cliente, monkeypatch):
    # Aunque el entorno traiga MONGO_URL, el servicio no tiene driver de Mongo: no lo usa.
    monkeypatch.setenv("MONGO_URL", "mongodb://127.0.0.1:1/retaildb")
    r = cliente.get("/v1/health")

    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["service"] == "basket-analysis-service"
    assert cuerpo["checks"]["postgres"] == "no configurado"
    assert cuerpo["checks"]["mongodb"] == "no configurado"
    # Sin Redis en la prueba: degrada, pero responde 200 (D-25).
    assert cuerpo["checks"]["redis"].startswith("error")
    assert cuerpo["status"] == "degraded"


def test_health_en_xml_lleva_el_namespace_del_servicio(cliente):
    r = cliente.get("/v1/health", headers={"Accept": "application/xml"})

    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/xml")
    assert 'xmlns="basket-analysis/v1"' in r.text


def test_cors_para_la_web_local(cliente):
    r = cliente.options("/v1/health", headers={"Origin": "http://localhost:5173",
                                               "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"


def test_puerto_y_variables_de_despliegue():
    dockerfile = (RAIZ / "Dockerfile").read_text(encoding="utf-8")
    assert "ENV PORT=3113" in dockerfile and "EXPOSE 3113" in dockerfile

    variables = {linea.split("=", 1)[0] for linea in (RAIZ / ".env.example").read_text(encoding="utf-8").splitlines()
                 if "=" in linea and not linea.startswith("#")}
    obligatorias = {"PORT", "SERVICE_NAME", "XML_NAMESPACE", "JWT_ACCESS_SECRET", "REDIS_HOST", "REDIS_PORT",
                    "CORE_PROCESS_SERVICE_URL", "CATALOG_SERVICE_URL", "INCOME_SEGMENTATION_SERVICE_URL",
                    "PUBLICATION_RULE"}
    assert obligatorias <= variables
    assert not {"DB_HOST", "DB_USER", "DB_PASSWORD", "MONGO_URL"} & variables  # no guarda nada
