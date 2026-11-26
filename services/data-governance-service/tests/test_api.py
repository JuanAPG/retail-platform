"""Las 14 rutas de punta a punta: PostgreSQL real en un esquema temporal (con la migración aplicada),
los 4 dueños simulados y la sesión de los usuarios reales del seed por rol.

Se salta sin `DB_HOST_PRUEBAS`, igual que `test_repositorio.py`. Cada respuesta XML se valida contra
`docs/contratos/data-governance-service.xsd` (lxml).
"""
import json
import os
from pathlib import Path

import httpx
import psycopg2
import psycopg2.pool
import pytest
from fastapi.testclient import TestClient
from lxml import etree

from app import avisos
from app.auth_session import sesion_actual
from app.fuentes import Fuentes, obtener_fuentes
from app.main import app
from app.repositorio import Repositorio, obtener_repositorio
from app.roles import PERFILES_INTERNOS, ROL
from test_informes import Duenos

HOST = os.getenv("DB_HOST_PRUEBAS")
pytestmark = pytest.mark.skipif(not HOST, reason="Sin DB_HOST_PRUEBAS: no hay PostgreSQL de verdad.")
RAIZ = Path(__file__).resolve().parents[3]
XSD = etree.XMLSchema(etree.parse(str(RAIZ / "docs/contratos/data-governance-service.xsd")))
EJEMPLOS = RAIZ / "docs/contratos/ejemplos"
ESQUEMA = f"gob_api_{os.getpid()}"
CONEXION = {"host": HOST, "port": int(os.getenv("DB_PORT", "5432")), "user": os.getenv("DB_USER", "retail_user"),
            "password": os.getenv("DB_PASSWORD", "retail_pass_2026"), "dbname": os.getenv("DB_NAME", "retaildb")}
LOTE = "05dbdf5a-8342-4d61-bfce-e04e2b644f9b"


@pytest.fixture(scope="module")
def base():
    admin = psycopg2.connect(**CONEXION)
    admin.autocommit = True
    with admin.cursor() as c:
        c.execute(f"DROP SCHEMA IF EXISTS {ESQUEMA} CASCADE; CREATE SCHEMA {ESQUEMA}; SET search_path TO {ESQUEMA}, public;")
        c.execute((RAIZ / "db/migraciones/sprint4_data_governance.sql").read_text(encoding="utf-8"))
        c.execute("SELECT r.nombre, u.id::text FROM public.usuarios u JOIN public.roles r ON r.id = u.rol_id "
                  "WHERE u.activo ORDER BY u.email")
        usuarios = dict(c.fetchall())
    pool = psycopg2.pool.ThreadedConnectionPool(1, 4, **CONEXION, options=f"-c search_path={ESQUEMA},public")
    yield Repositorio(pool), usuarios
    pool.closeall()
    with admin.cursor() as c:
        c.execute(f"DROP SCHEMA {ESQUEMA} CASCADE")
    admin.close()


@pytest.fixture
def entorno(base, monkeypatch):
    repo, usuarios = base
    auditados = []
    monkeypatch.setattr(avisos, "_auditar", lambda cuerpo, ctx, que: auditados.append(cuerpo))
    for variable, host in [("INGESTION_SERVICE_URL", "ingestion"), ("CORE_PROCESS_SERVICE_URL", "core"),
                           ("AVAILABILITY_SERVICE_URL", "availability"), ("INCOME_SEGMENTATION_SERVICE_URL", "segmentos")]:
        monkeypatch.setenv(variable, f"http://{host}")
    duenos = Duenos()
    estado = {"rol": ROL.ADMINISTRADOR}
    app.dependency_overrides[sesion_actual] = lambda: {
        "id": usuarios.get(estado["rol"], usuarios[ROL.ADMINISTRADOR]), "rol": estado["rol"]}
    app.dependency_overrides[obtener_repositorio] = lambda: repo
    app.dependency_overrides[obtener_fuentes] = lambda: Fuentes("Bearer tok", httpx.Client(transport=duenos.transporte))
    yield {"cliente": TestClient(app), "estado": estado, "usuarios": usuarios, "auditados": auditados, "duenos": duenos}
    app.dependency_overrides.clear()


def como(entorno, rol):
    entorno["estado"]["rol"] = rol
    return entorno["cliente"]


def xml(cliente, metodo, ruta, **kw):
    r = cliente.request(metodo, ruta, headers={"Accept": "application/xml", **kw.pop("headers", {})}, **kw)
    XSD.assertValid(etree.fromstring(r.content))
    return r


def linaje(recurso, version="sha-1", insumos=(), **extra):
    return {"service": "demand-forecast-service", "resourceType": "corrida", "resourceId": recurso,
            "description": "Pronóstico de prueba", "source": {"key": "ventas-core-process", "version": version},
            "inputs": [{"service": s, "resourceType": t, "resourceId": r} for s, t, r in insumos],
            "occurredAt": "2026-11-25T18:04:12.317000+00:00", **extra}


def oid(n):
    return f"{n:024x}"


# --- Fuentes y versiones

def test_fuentes_listado_detalle_y_xml(entorno):
    c = como(entorno, ROL.GERENTE_CATEGORIA)
    r = c.get("/v1/sources", params={"type": "sintetico"})
    assert r.status_code == 200 and [f["key"] for f in r.json()["data"]] == ["generador-sintetico", "seed-demo"]
    assert b"<sourceListResponse" in xml(c, "GET", "/v1/sources").content
    assert c.get("/v1/sources/inegi-enigh").json()["currentVersion"] == "ENIGH 2022"
    assert b"<sourceResponse" in xml(c, "GET", "/v1/sources/inegi-enigh").content
    assert xml(c, "GET", "/v1/sources/no-existe").status_code == 404
    assert c.get("/v1/sources", params={"tipo": "x"}).status_code == 400


def test_alta_y_cambio_de_fuente_con_bitacora(entorno):
    c = como(entorno, ROL.ADMINISTRADOR)
    cuerpo = {"key": "precios-competencia", "name": "Precios de la competencia", "type": "referencia_externa",
              "ownerService": "pricing-service"}
    r = xml(c, "POST", "/v1/sources", json=cuerpo)
    assert r.status_code == 201 and b"<sourceResponse" in r.content
    assert entorno["auditados"][-1]["accion"] == "insert" and entorno["auditados"][-1]["tabla"] == "fuentes_datos"
    assert c.post("/v1/sources", json=cuerpo).status_code == 409

    r = c.patch("/v1/sources/precios-competencia", json={"active": False})
    assert r.status_code == 200 and r.json()["active"] is False
    assert entorno["auditados"][-1]["cambios"] == [{"campo": "active", "previo": "true", "posterior": "false"}]
    for prohibido in ({"key": "otra"}, {"type": "sintetico"}):
        assert c.patch("/v1/sources/precios-competencia", json=prohibido).status_code == 400
    assert c.patch("/v1/sources/no-existe", json={"active": True}).status_code == 404


@pytest.mark.parametrize("cambio", [{"key": "Mala_Clave"}, {"type": "otro"}, {"ownerService": "x-service"},
                                    {"extra": 1}, {"name": ""}])
def test_alta_de_fuente_invalida_400(entorno, cambio):
    cuerpo = {"key": "valida-123", "name": "x", "type": "sintetico", "ownerService": "pricing-service", **cambio}
    r = como(entorno, ROL.ADMINISTRADOR).post("/v1/sources", json=cuerpo)
    assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"


def test_versiones_alta_lista_y_raiz_segun_metodo(entorno):
    c = como(entorno, ROL.ADMINISTRADOR)
    r = xml(c, "POST", "/v1/sources/inegi-enigh/versions", json={"version": "ENIGH 2024", "description": "Julio 2025"})
    assert r.status_code == 201 and b"<sourceVersionResponse" in r.content  # POST: una versión
    assert entorno["auditados"][-1]["tabla"] == "fuente_versiones"
    assert c.post("/v1/sources/inegi-enigh/versions", json={"version": "ENIGH 2024"}).status_code == 409
    r = xml(c, "GET", "/v1/sources/inegi-enigh/versions")
    assert b"<sourceVersionListResponse" in r.content  # GET: la lista
    assert c.get("/v1/sources/inegi-enigh/versions").json()["data"][0]["version"] == "ENIGH 2024"
    assert c.post("/v1/sources/no-existe/versions", json={"version": "v1"}).status_code == 404


# --- Linaje (DG-3, DG-4, DG-6)

def test_linaje_201_luego_200_y_409(entorno):
    c = como(entorno, ROL.ANALISTA)
    r = xml(c, "POST", "/v1/lineage", json=linaje(oid(1)), headers={"X-Correlation-Id": "op-77"})
    assert r.status_code == 201 and b"<lineageRecordResponse" in r.content
    primero = c.get("/v1/lineage", params={"resourceId": oid(1)}).json()["data"][0]
    assert (primero["userId"], primero["correlationId"]) == (entorno["usuarios"][ROL.ANALISTA], "op-77")

    r = c.post("/v1/lineage", json=linaje(oid(1)))
    assert r.status_code == 200 and r.json()["id"] == primero["id"]
    r = xml(c, "POST", "/v1/lineage", json=linaje(oid(1), version="sha-otra"))
    assert r.status_code == 409
    assert entorno["auditados"] == []  # el linaje no se audita


@pytest.mark.parametrize("cambio", [
    {"resourceId": "no-es-objectid"},                                                  # DG-4
    {"resourceType": "importacion", "resourceId": oid(2)},                             # importación = UUID
    {"resourceType": "version_segmento", "resourceId": "2-3"},                         # "{segmentId}:{version}"
    {"service": "x-service"},
    {"occurredAt": "2026-11-25T18:04:12"},                                             # sin zona horaria
    {"inputs": [{"service": "transactions-ingestion-service", "resourceType": "importacion", "resourceId": LOTE}] * 2},
    {"userId": "lo-pone-el-token"},                                                    # no viene en el cuerpo
])
def test_linaje_invalido_400(entorno, cambio):
    r = como(entorno, ROL.ANALISTA).post("/v1/lineage", json={**linaje(oid(9)), **cambio})
    assert r.status_code == 400


def test_linaje_con_fuente_inexistente_400(entorno):
    cuerpo = linaje(oid(10))
    cuerpo["source"]["key"] = "no-existe"
    r = como(entorno, ROL.ANALISTA).post("/v1/lineage", json=cuerpo)
    assert r.status_code == 400 and "no existe" in r.json()["message"]


def test_solo_lo_propio(entorno):
    analista = como(entorno, ROL.ANALISTA)
    mio = analista.post("/v1/lineage", json=linaje(oid(20))).json()
    planeador = como(entorno, ROL.PLANEADOR)
    ajeno = planeador.post("/v1/lineage", json=linaje(oid(21))).json()

    analista = como(entorno, ROL.ANALISTA)
    ids = {r["id"] for r in analista.get("/v1/lineage", params={"limit": 100}).json()["data"]}
    assert mio["id"] in ids and ajeno["id"] not in ids
    r = xml(analista, "GET", f"/v1/lineage/{ajeno['id']}")
    assert r.status_code == 404  # ajeno = inexistente (DG-6)
    for rol in (ROL.ADMINISTRADOR, ROL.AUDITOR):
        assert como(entorno, rol).get(f"/v1/lineage/{ajeno['id']}").status_code == 200


def test_origen_corrida_que_salio_de_un_lote(entorno):
    planeador = como(entorno, ROL.PLANEADOR)
    planeador.post("/v1/lineage", json={**linaje(LOTE), "service": "transactions-ingestion-service",
                                        "resourceType": "importacion", "source": {"key": "ventas-archivo",
                                                                                  "version": "sha-archivo"}})
    analista = como(entorno, ROL.ANALISTA)
    corrida = analista.post("/v1/lineage", json=linaje(oid(30), insumos=[
        ("transactions-ingestion-service", "importacion", LOTE),
        ("algorithms-core", "corrida", oid(31))])).json()   # sin linaje registrado

    # Analista: el lote es del Planeador → restringido; el otro insumo no está registrado.
    r = xml(analista, "GET", f"/v1/lineage/{corrida['id']}/origin")
    assert r.status_code == 200 and b"<lineageOriginResponse" in r.content
    arbol = analista.get(f"/v1/lineage/{corrida['id']}/origin").json()
    lote, sin_registro = arbol["root"]["inputs"]
    assert (lote["registered"], lote["restricted"], "record" in lote) == (True, True, False)
    assert (sin_registro["registered"], sin_registro["restricted"]) == (False, False)
    assert arbol["root"]["source"]["ownerService"] == "core-process-service"
    assert arbol["root"]["sourceVersion"]["origin"] == "linaje"

    # Administrador: el árbol completo de 2 niveles, con fuente, versión, quién y cuándo (D-43).
    arbol = como(entorno, ROL.ADMINISTRADOR).get(f"/v1/lineage/{corrida['id']}/origin").json()
    lote = arbol["root"]["inputs"][0]
    assert (arbol["depth"], arbol["truncated"]) == (2, False)
    assert (lote["restricted"], lote["source"]["key"], lote["record"]["userId"]) == (
        False, "ventas-archivo", entorno["usuarios"][ROL.PLANEADOR])
    xml(como(entorno, ROL.ADMINISTRADOR), "GET", f"/v1/lineage/{corrida['id']}/origin")


# --- Calidad

def test_reporte_de_calidad_y_auditor_sin_lectura_en_ingestion(entorno):
    c = como(entorno, ROL.ANALISTA)
    r = xml(c, "GET", "/v1/quality-report", params={"dateFrom": "2026-11-01", "dateTo": "2026-11-25"})
    assert r.status_code == 200
    ventas = c.get("/v1/quality-report", params={"dateFrom": "2026-11-01", "dateTo": "2026-11-25"}).json()["sources"][0]
    assert (ventas["sourceKey"], ventas["sampleSize"]) == ("ventas-archivo", 254)

    entorno["duenos"].prohibidos.add("ingestion")
    auditor = como(entorno, ROL.AUDITOR)
    ventas = auditor.get("/v1/quality-report", params={"sourceKey": "ventas-archivo"}).json()["sources"]
    assert ventas[0]["metrics"][0]["motivo"] == "transactions-ingestion-service no da lectura a este rol (pedido en el contrato)."
    xml(auditor, "GET", "/v1/quality-report", params={"sourceKey": "ventas-archivo"})


@pytest.mark.parametrize("params, status", [({"sourceKey": "no-existe"}, 404), ({"sourceKey": "seed-demo"}, 400),
                                            ({"dateFrom": "2026-11-02", "dateTo": "2026-11-01"}, 400),
                                            ({"desde": "x"}, 400)])
def test_reporte_de_calidad_invalido(entorno, params, status):
    assert como(entorno, ROL.AUDITOR).get("/v1/quality-report", params=params).status_code == status


# --- Retención

def test_politicas_evaluacion_y_simulacion(entorno):
    c = como(entorno, ROL.AUDITOR)
    assert len(xml(c, "GET", "/v1/retention-policies").content) > 0
    assert len(c.get("/v1/retention-policies").json()["data"]) == 6

    r = c.get("/v1/retention/evaluation", params={"asOf": "2029-09-01"})
    assert r.json()["data"][0]["expiredCount"] == 56
    xml(c, "GET", "/v1/retention/evaluation", params={"asOf": "2029-09-01"})
    assert c.get("/v1/retention/evaluation", params={"asOf": "01/09/2029"}).status_code == 400

    pedido = json.loads((EJEMPLOS / "data-governance-retention-simulation-request.json").read_text(encoding="utf-8"))
    esperado = json.loads((EJEMPLOS / "data-governance-retention-simulation.json").read_text(encoding="utf-8"))
    assert c.post("/v1/retention/simulate", json=pedido).json() == esperado
    xml(c, "POST", "/v1/retention/simulate", json=pedido)


@pytest.mark.parametrize("registros", [[], [{"dataset": "transacciones", "recordId": "x", "date": "2024-01-01"}] * 1001,
                                       [{"dataset": "ventas", "recordId": "x", "date": "2024-01-01"}],
                                       [{"dataset": "transacciones", "recordId": "x", "date": "2024-02-30"}]])
def test_simulacion_invalida_400(entorno, registros):
    r = como(entorno, ROL.ADMINISTRADOR).post("/v1/retention/simulate", json={"asOf": "2026-11-25", "records": registros})
    assert r.status_code == 400


# --- Permisos (Matriz §3.2)

RUTAS = [("GET", "/v1/sources", PERFILES_INTERNOS),
         ("GET", "/v1/lineage", PERFILES_INTERNOS),
         ("GET", "/v1/quality-report", (ROL.ADMINISTRADOR, ROL.AUDITOR, ROL.ANALISTA)),
         ("GET", "/v1/retention-policies", (ROL.ADMINISTRADOR, ROL.AUDITOR)),
         ("GET", "/v1/retention/evaluation", (ROL.ADMINISTRADOR, ROL.AUDITOR))]
TODOS = (*PERFILES_INTERNOS, ROL.PROVEEDOR, ROL.INVESTIGADOR)


@pytest.mark.parametrize("rol", TODOS)
def test_permisos_por_rol(entorno, rol):
    c = como(entorno, rol)
    for metodo, ruta, permitidos in RUTAS:
        assert c.request(metodo, ruta).status_code == (200 if rol in permitidos else 403), (rol, ruta)
    escribe_fuentes = 201 if rol == ROL.ADMINISTRADOR else 403
    assert c.post("/v1/sources", json={"key": f"permiso-{abs(hash(rol)) % 10**6}", "name": "x", "type": "sintetico",
                                       "ownerService": "pricing-service"}).status_code == escribe_fuentes
    registra = rol in (ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS, ROL.PLANEADOR)
    r = c.post("/v1/lineage", json=linaje(oid(1000 + TODOS.index(rol))))
    assert r.status_code == (201 if registra else 403), rol


def test_sin_sesion_401_en_xml(entorno):
    app.dependency_overrides.pop(sesion_actual)
    assert xml(entorno["cliente"], "GET", "/v1/sources").status_code == 401


# --- Swagger

def test_swagger_trae_ejemplos_validos():
    rutas = TestClient(app).get("/openapi.json").json()["paths"]
    revisados = 0
    for ruta, metodos in rutas.items():
        for metodo, operacion in metodos.items():
            for status, respuesta in operacion.get("responses", {}).items():
                ejemplo = respuesta.get("content", {}).get("application/xml", {}).get("example")
                if ejemplo:
                    XSD.assertValid(etree.fromstring(ejemplo.encode()))
                    revisados += 1
    assert revisados >= 60
