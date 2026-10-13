"""El repositorio de corridas contra un MongoDB de verdad (mongomock lo imita).

Se salta sin `MONGO_URL_PRUEBAS` (en el CI no hay Mongo). Usa una base aparte
y la borra al terminar: nunca toca `retaildb`.

    MONGO_URL_PRUEBAS="mongodb://retail_admin:retail_pass_2026@localhost:27017/analytics_pruebas?authSource=admin" \
        python -m pytest tests/test_mongo_real.py
"""
import os
from datetime import datetime, timezone

import pytest
from pymongo import MongoClient

from app.corridas import Corridas

URL = os.getenv("MONGO_URL_PRUEBAS")
pytestmark = pytest.mark.skipif(not URL, reason="Sin MONGO_URL_PRUEBAS: no hay MongoDB de verdad.")


@pytest.fixture
def corridas():
    cliente = MongoClient(URL, tz_aware=True, serverSelectionTimeoutMS=3000)
    base = cliente.get_default_database()
    assert base.name != "retaildb", "Usa una base de pruebas, no la de la plataforma."
    cliente.drop_database(base.name)
    yield Corridas(cliente), base["analysis_runs"]
    cliente.drop_database(base.name)
    cliente.close()


def corrida(minuto: int, usuario: str = "u-1") -> dict:
    return {"userId": usuario, "date": datetime(2026, 10, 13, 4, minuto, 30, 123456, tzinfo=timezone.utc),
            "parameters": {"k": 2, "seed": 42, "features": ["estimatedIncome"], "source": "cuerpo"},
            "input": [{"zoneId": "z-1", "estimatedIncome": 1.0}], "clusters": [],
            "assignments": [{"zoneId": "z-1", "cluster": 1}], "excludedZones": [],
            "inertia": 0.5, "silhouette": None, "assumptions": ["x"]}


def test_guarda_y_relee_igual_con_su_indice(corridas):
    repositorio, coleccion = corridas

    guardada = repositorio.guardar(corrida(1))

    assert repositorio.obtener(guardada["id"]) == guardada
    assert guardada["date"] == "2026-10-13T04:01:30.123000+00:00"
    indice = coleccion.index_information()["userId_date"]
    assert indice["key"] == [("userId", 1), ("date", -1)]


def test_lista_de_la_mas_reciente_sin_la_entrada(corridas):
    repositorio, _ = corridas
    ids = [repositorio.guardar(corrida(m))["id"] for m in (1, 3, 2)]

    datos, total = repositorio.listar(1, 2)

    assert total == 3
    assert [d["id"] for d in datos] == [ids[1], ids[2]]
    assert datos[0]["zoneCount"] == 1 and "input" not in datos[0]
