"""El repositorio contra un PostgreSQL de verdad, en un esquema temporal con la migración aplicada.

Se salta sin `DB_HOST_PRUEBAS`. Crea `gob_pruebas_<pid>` dentro de la base, le aplica
`db/migraciones/sprint4_data_governance.sql` y lo borra al terminar: nunca toca las tablas de
`public`. Usa usuarios reales del seed (`public.usuarios`) por la llave foránea.

    DB_HOST_PRUEBAS=localhost DB_PASSWORD=retail_pass_2026 python -m pytest tests/test_repositorio.py
"""
import os
import threading
from pathlib import Path

import psycopg2
import psycopg2.pool
import pytest
from fastapi import HTTPException

from app.dominio import ErrorDominio
from app.repositorio import Repositorio

HOST = os.getenv("DB_HOST_PRUEBAS")
pytestmark = pytest.mark.skipif(not HOST, reason="Sin DB_HOST_PRUEBAS: no hay PostgreSQL de verdad.")
MIGRACION = Path(__file__).resolve().parents[3] / "db/migraciones/sprint4_data_governance.sql"
ESQUEMA = f"gob_pruebas_{os.getpid()}"
CONEXION = {"host": HOST, "port": int(os.getenv("DB_PORT", "5432")), "user": os.getenv("DB_USER", "retail_user"),
            "password": os.getenv("DB_PASSWORD", "retail_pass_2026"), "dbname": os.getenv("DB_NAME", "retaildb")}


@pytest.fixture(scope="module")
def base():
    admin = psycopg2.connect(**CONEXION)
    admin.autocommit = True
    with admin.cursor() as c:
        c.execute(f"DROP SCHEMA IF EXISTS {ESQUEMA} CASCADE; CREATE SCHEMA {ESQUEMA}; SET search_path TO {ESQUEMA}, public;")
        c.execute(MIGRACION.read_text(encoding="utf-8"))
        c.execute("SELECT id::text FROM public.usuarios WHERE activo ORDER BY email LIMIT 2")
        usuarios = [f[0] for f in c.fetchall()]
    pool = psycopg2.pool.ThreadedConnectionPool(1, 4, **CONEXION, options=f"-c search_path={ESQUEMA},public")
    yield Repositorio(pool), usuarios
    pool.closeall()
    with admin.cursor() as c:
        c.execute(f"DROP SCHEMA {ESQUEMA} CASCADE")
    admin.close()


def linaje(recurso="c-1", version="sha-1", **extra):
    return {"service": "demand-forecast-service", "resourceType": "corrida", "resourceId": recurso,
            "description": "Pronóstico de prueba", "source": {"key": "ventas-core-process", "version": version},
            "inputs": [{"service": "transactions-ingestion-service", "resourceType": "importacion", "resourceId": "lote-1"}],
            "occurredAt": "2026-11-25T18:04:12.317000+00:00", **extra}


# --- Fuentes y versiones

def test_fuentes_sembradas_con_su_version_actual(base):
    repo, _ = base
    fuentes, total = repo.listar_fuentes(None, None, None, 1, 20)
    por_clave = {f["key"]: f for f in fuentes}
    assert total == 6 and [f["key"] for f in fuentes] == sorted(por_clave)
    assert por_clave["inegi-enigh"]["currentVersion"] == "ENIGH 2022"
    assert por_clave["ventas-archivo"]["currentVersion"] is None
    assert por_clave["seed-demo"]["createdBy"] is None  # sembrada
    assert repo.listar_fuentes("sintetico", None, None, 1, 20)[1] == 2


def test_alta_duplicada_y_desactivacion_de_fuente(base):
    repo, usuarios = base
    nueva = repo.crear_fuente({"key": "precios-competencia", "name": "Precios de la competencia",
                               "type": "referencia_externa", "ownerService": "pricing-service"}, usuarios[0])
    assert (nueva["createdBy"], nueva["active"], nueva["currentVersion"]) == (usuarios[0], True, None)
    with pytest.raises(ErrorDominio) as error:
        repo.crear_fuente({"key": "precios-competencia", "name": "x", "type": "sintetico", "ownerService": "x"},
                          usuarios[0])
    assert error.value.status == 409
    antes, despues = repo.actualizar_fuente("precios-competencia", {"active": False, "name": "Precios publicados"})
    assert (antes["active"], despues["active"], despues["name"]) == (True, False, "Precios publicados")
    with pytest.raises(HTTPException) as error:
        repo.obtener_fuente("no-existe")
    assert error.value.status_code == 404


def test_versiones_manuales_y_la_actual(base):
    repo, usuarios = base
    v = repo.crear_version("inegi-enigh", "ENIGH 2024", "Publicada en julio de 2025", usuarios[0])
    assert (v["sourceKey"], v["origin"], v["createdBy"]) == ("inegi-enigh", "manual", usuarios[0])
    assert repo.obtener_fuente("inegi-enigh")["currentVersion"] == "ENIGH 2024"
    versiones, total = repo.listar_versiones("inegi-enigh", 1, 20)
    assert total == 2 and versiones[0]["version"] == "ENIGH 2024"  # la más reciente primero
    with pytest.raises(ErrorDominio) as error:
        repo.crear_version("inegi-enigh", "ENIGH 2024", None, usuarios[0])
    assert error.value.status == 409
    with pytest.raises(HTTPException) as error:
        repo.crear_version("no-existe", "v1", None, usuarios[0])
    assert error.value.status_code == 404


# --- Linaje (DG-2, DG-3)

def test_linaje_201_luego_200_con_el_mismo_id(base):
    repo, usuarios = base
    primero, creado = repo.registrar(linaje("c-idem"), usuarios[0], "op-1")
    segundo, otra_vez = repo.registrar(linaje("c-idem"), usuarios[0], "op-2")
    assert (creado, otra_vez) == (True, False)
    assert segundo == primero  # el original, con su correlación
    assert (primero["userId"], primero["correlationId"]) == (usuarios[0], "op-1")
    assert primero["inputs"] == [{"service": "transactions-ingestion-service", "resourceType": "importacion",
                                  "resourceId": "lote-1"}]


def test_mismo_recurso_con_otro_contenido_409_y_el_original_intacto(base):
    repo, usuarios = base
    original, _ = repo.registrar(linaje("c-conflicto", version="sha-a"), usuarios[0], None)
    with pytest.raises(ErrorDominio) as error:
        repo.registrar(linaje("c-conflicto", version="sha-b"), usuarios[0], None)
    assert error.value.status == 409 and "no se sobrescribe" in error.value.mensaje
    assert repo.buscar(("demand-forecast-service", "corrida", "c-conflicto")) == original
    # La versión del intento rechazado no quedó registrada.
    assert repo.version_de("ventas-core-process", "sha-b") is None


def test_version_nueva_se_crea_con_origen_linaje(base):
    repo, usuarios = base
    repo.registrar(linaje("c-version", version="sha-nueva"), usuarios[0], None)
    v = repo.version_de("ventas-core-process", "sha-nueva")
    assert (v["origin"], v["createdBy"]) == ("linaje", usuarios[0])
    assert repo.obtener_fuente("ventas-core-process")["currentVersion"] == "sha-nueva"


@pytest.mark.parametrize("clave, texto", [("no-existe", "no existe"), ("precios-competencia", "está inactiva")])
def test_fuente_inexistente_o_inactiva_da_400(base, clave, texto):
    repo, usuarios = base
    if clave == "precios-competencia":
        try:
            repo.crear_fuente({"key": clave, "name": "x", "type": "sintetico", "ownerService": "pricing-service"},
                              usuarios[0])
        except ErrorDominio:
            pass
        repo.actualizar_fuente(clave, {"active": False})
    cuerpo = linaje(f"c-{clave}")
    cuerpo["source"]["key"] = clave
    with pytest.raises(ErrorDominio) as error:
        repo.registrar(cuerpo, usuarios[0], None)
    assert error.value.status == 400 and texto in error.value.mensaje


def test_dos_registros_iguales_al_mismo_tiempo(base):
    repo, usuarios = base
    resultados, errores = [], []

    def registrar():
        try:
            resultados.append(repo.registrar(linaje("c-carrera"), usuarios[0], None))
        except Exception as error:  # noqa: BLE001
            errores.append(error)

    hilos = [threading.Thread(target=registrar) for _ in range(4)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert errores == []
    assert sorted(creado for _, creado in resultados) == [False, False, False, True]
    assert len({r["id"] for r, _ in resultados}) == 1


# --- DG-6: solo lo propio

def test_listado_y_detalle_solo_lo_propio(base):
    repo, usuarios = base
    mio, _ = repo.registrar(linaje("c-de-a"), usuarios[0], None)
    ajeno, _ = repo.registrar(linaje("c-de-b"), usuarios[1], None)

    propios, _ = repo.listar_registros({}, usuarios[0], 1, 100)
    assert mio["id"] in {r["id"] for r in propios} and ajeno["id"] not in {r["id"] for r in propios}
    todos, total = repo.listar_registros({}, None, 1, 100)
    assert {mio["id"], ajeno["id"]} <= {r["id"] for r in todos}
    filtrados, _ = repo.listar_registros({"resourceId": "c-de-b"}, None, 1, 100)
    assert [r["id"] for r in filtrados] == [ajeno["id"]]

    assert repo.obtener_registro(ajeno["id"], None)["id"] == ajeno["id"]
    for id_registro, solo_de in [(ajeno["id"], usuarios[0]), ("00000000-0000-4000-8000-000000000000", None),
                                 ("no-es-uuid", None)]:
        with pytest.raises(HTTPException) as error:
            repo.obtener_registro(id_registro, solo_de)
        assert error.value.status_code == 404


# --- Políticas y fallas

def test_politicas_de_d43_en_orden(base):
    repo, _ = base
    politicas = repo.politicas()
    assert [(p["dataset"], p["retentionPeriod"]) for p in politicas] == [
        ("transacciones", "P3Y"), ("capturas_disponibilidad", "P1Y"), ("observaciones_precio", "P1Y"),
        ("visitas_campo", "P1Y"), ("notificaciones", "P90D"), ("bitacora", None)]


def test_postgres_caido_da_503():
    class PoolCaido:
        def getconn(self):
            raise psycopg2.OperationalError("connection refused")

    with pytest.raises(HTTPException) as error:
        Repositorio(PoolCaido()).politicas()
    assert (error.value.status_code, error.value.detail) == (503, "PostgreSQL no responde.")
