"""Repositorio de corridas (D-47) con mongomock: guardar, listar, leer, índices y Mongo caído (D-25)."""
from datetime import datetime, timezone

import mongomock
import pytest
from fastapi import HTTPException
from pymongo.errors import ServerSelectionTimeoutError

from app.corridas import Corridas

PRODUCTO, OTRO = "3f6c2a10-8b4e-4c1d-9a7e-1b2c3d4e5f60", "aaaaaaaa-8b4e-4c1d-9a7e-1b2c3d4e5f60"
ZONA = "97925ca4-3845-4e68-9660-46f781957b8c"


def corrida(minuto, producto=PRODUCTO, disponible=True):
    base = {"userId": "u-1", "date": datetime(2026, 11, 25, 18, minuto, 12, 317456, tzinfo=timezone.utc),
            "durationMs": 127.4, "parameters": {"productId": producto, "zoneId": ZONA, "horizonWeeks": 8},
            "product": {"id": producto, "name": "Leche entera", "unit": "l", "unitType": "volumen"},
            "disponible": disponible, "coverage": {"transactions": 40, "stores": 4}}
    if disponible:
        base |= {"dataVersion": {"sha256": "be30", "weeks": 20}, "history": [{"weekStart": "2026-07-06"}],
                 "validation": {"mape": 9.88, "holdout": []}, "forecast": [{"quantity": 1.0}]}
    return base


@pytest.fixture
def repo():
    cliente = mongomock.MongoClient("mongodb://localhost:27017/retaildb", tz_aware=True)
    return Corridas(cliente), cliente.retaildb.forecast_runs


def test_guardar_devuelve_lo_mismo_que_se_relee(repo):
    corridas, _ = repo
    guardada = corridas.guardar(corrida(4))

    assert guardada["date"] == "2026-11-25T18:04:12.317000+00:00"  # milisegundos, como BSON
    assert guardada["type"] == "forecast"
    assert "_id" not in guardada and len(guardada["id"]) == 24
    assert corridas.obtener(guardada["id"]) == guardada


def test_crea_los_dos_indices_del_contrato(repo):
    corridas, coleccion = repo
    corridas.guardar(corrida(4))
    indices = {i["name"]: i["key"] for i in coleccion.list_indexes()}
    assert list(indices["userId_date"].items()) == [("userId", 1), ("date", -1)]
    assert list(indices["productId_date"].items()) == [("parameters.productId", 1), ("date", -1)]


def test_listado_resumido_mas_reciente_primero_y_filtrado(repo):
    corridas, _ = repo
    vieja = corridas.guardar(corrida(1))
    no_disp = corridas.guardar(corrida(2, disponible=False))
    corridas.guardar(corrida(3, producto=OTRO))

    filas, total = corridas.listar(PRODUCTO, None, pagina=1, limite=20)
    assert total == 2
    assert [f["id"] for f in filas] == [no_disp["id"], vieja["id"]]
    assert filas[1] == {"id": vieja["id"], "date": "2026-11-25T18:01:12.317000+00:00", "userId": "u-1",
                        "productId": PRODUCTO, "zoneId": ZONA, "unit": "l", "disponible": True, "weeks": 20,
                        "mape": 9.88, "durationMs": 127.4}
    # Una no disponible no tiene semanas ni MAPE: nulos, nunca 0 (D-36).
    assert (filas[0]["weeks"], filas[0]["mape"]) == (None, None)

    assert corridas.listar(None, ZONA, 1, 20)[1] == 3
    assert corridas.listar(None, "otra-zona", 1, 20) == ([], 0)


def test_paginacion(repo):
    corridas, _ = repo
    ids = [corridas.guardar(corrida(m))["id"] for m in range(5)]
    pagina2, total = corridas.listar(None, None, pagina=2, limite=2)
    assert total == 5
    assert [f["id"] for f in pagina2] == [ids[2], ids[1]]


def test_id_invalido_400_e_inexistente_404(repo):
    corridas, _ = repo
    with pytest.raises(HTTPException) as error:
        corridas.obtener("no-es-un-id")
    assert error.value.status_code == 400
    with pytest.raises(HTTPException) as error:
        corridas.obtener("674a1f3c9e2b4d0012ab34cd")
    assert error.value.status_code == 404


def test_mongo_caido_da_503_y_no_devuelve_la_corrida(repo, monkeypatch):
    corridas, coleccion = repo

    def caido(*_a, **_k):
        raise ServerSelectionTimeoutError("mongodb:27017: timed out")

    monkeypatch.setattr(type(coleccion), "insert_one", caido)
    with pytest.raises(HTTPException) as error:
        corridas.guardar(corrida(4))
    assert error.value.status_code == 503
    assert error.value.detail == "MongoDB no responde: no se pudo guardar la corrida."

    monkeypatch.setattr(type(coleccion), "count_documents", caido)
    with pytest.raises(HTTPException) as error:
        corridas.listar(None, None, 1, 20)
    assert error.value.status_code == 503
