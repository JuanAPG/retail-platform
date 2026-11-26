"""El repositorio de corridas contra un MongoDB de verdad (mongomock lo imita).

Se salta sin `MONGO_URL_PRUEBAS` (en el CI no hay Mongo). Usa una base aparte y la borra al
terminar: nunca toca `retaildb`.

    MONGO_URL_PRUEBAS="mongodb://retail_admin:retail_pass_2026@localhost:27017/forecast_pruebas?authSource=admin" \
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
    yield Corridas(cliente), base["forecast_runs"]
    cliente.drop_database(base.name)
    cliente.close()


def test_guarda_relee_igual_y_lista_con_los_indices(corridas):
    repo, coleccion = corridas
    corrida = {"userId": "u-1", "date": datetime(2026, 11, 25, 18, 4, 12, 317456, tzinfo=timezone.utc),
               "durationMs": 127.4, "parameters": {"productId": "p-1", "zoneId": None},
               "product": {"unit": "kg"}, "disponible": True, "dataVersion": {"weeks": 52},
               "validation": {"mape": 0.0}, "history": [{"weekStart": "2025-11-24", "quantity": 48.0}]}

    guardada = repo.guardar(corrida)

    assert repo.obtener(guardada["id"]) == guardada
    assert guardada["date"] == "2026-11-25T18:04:12.317000+00:00"
    filas, total = repo.listar("p-1", None, 1, 20)
    assert total == 1 and filas[0]["weeks"] == 52 and filas[0]["mape"] == 0.0
    assert {"userId_date", "productId_date"} <= {i["name"] for i in coleccion.list_indexes()}
