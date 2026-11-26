"""Las 4 rutas de punta a punta con fuentes falsas y sesión simulada.

Cada respuesta XML se valida contra `docs/contratos/basket-analysis-service.xsd` (lxml).
"""
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from lxml import etree

from app.auth_session import sesion_actual
from app.fuentes import obtener_fuentes
from app.main import app
from app.periodos import inicio_de
from app.roles import PERFILES_INTERNOS, ROL

XSD = etree.XMLSchema(etree.parse(str(Path(__file__).resolve().parents[3] / "docs/contratos/basket-analysis-service.xsd")))
ZONA = "97925ca4-3845-4e68-9660-46f781957b8c"
AS_OF = "2026-11-25T18:20:00.000Z"
TODOS_LOS_ROLES = (*PERFILES_INTERNOS, ROL.PROVEEDOR, ROL.INVESTIGADOR)
# (producto, canastas que lo llevan de 100, gasto por canasta): 5 típicos y la frontera 20/19.
PRODUCTOS = [("p-01", 62, 57.0, 2), ("p-02", 55, 23.0, 5), ("p-03", 41, 42.5, 1), ("p-04", 33, 48.0, 4),
             ("p-05", 20, 55.5, 2), ("p-06", 19, 92.0, None)]


class FuentesFalsas:
    """Responde como core-process: un periodo sin `groupBy`; uno por semana o mes con él."""

    def __init__(self):
        self.canastas, self.tiendas = 100, 4
        self.vacios: set[str] = set()       # claves de periodo sin canastas
        self.chicos: set[str] = set()       # claves con 9 canastas (no disponibles)
        self.pedidas = []
        self.falta = None

    def zona(self, zid):
        if self.falta == "zona":
            raise HTTPException(404, f"No existe la zona {zid}.")
        return {"id": zid, "name": "Zona Centro"}

    def segmento(self, sid):
        if self.falta == "segmento":
            raise HTTPException(404, f"No existe el segmento {sid}.")
        return {"id": sid, "code": "ING_2", "name": "Ingreso medio"}

    def historial(self, _zid):
        return [{"segmentId": 2, "segmentVersion": 1, "validFrom": "2025-01-01", "validTo": None}]

    def categorias(self):
        return {1: "Abarrotes", 2: "Lácteos", 4: "Huevo", 5: "Tortillería"}

    def _periodo(self, clave):
        if clave in self.vacios:
            return None
        n = 9 if clave in self.chicos else self.canastas
        return {"periodStart": clave, "baskets": n, "stores": self.tiendas,
                "totalSpend": round(sum(k * g for _, k, g, _ in PRODUCTOS) * n / 100, 2)}

    def canastas_por_producto(self, zid, sid, desde, hasta, as_of=None, agrupar=None):
        if self.falta == "core":
            raise HTTPException(503, "core-process-service no respondió en 3 s.")
        self.pedidas.append({"desde": desde, "hasta": hasta, "asOf": as_of, "groupBy": agrupar})
        if agrupar:
            inicio, fin = desde or date(2026, 9, 1), hasta or date(2026, 10, 31)
            claves, dia = [], inicio
            while dia <= fin:
                clave = inicio_de(dia, agrupar).isoformat()
                if clave not in claves:
                    claves.append(clave)
                dia += timedelta(days=1)
        else:
            claves = [None]
        periodos = [p for p in (self._periodo(c) for c in claves) if p]
        filas = [{"periodStart": p["periodStart"], "productId": pid, "productName": f"Producto {pid}",
                  "categoryId": cat, "basketsWithProduct": round(k * p["baskets"] / 100) or 1,
                  "spend": round(k * p["baskets"] / 100 * g, 2)}
                 for p in periodos for pid, k, g, cat in PRODUCTOS]
        return {"asOf": as_of or AS_OF, "periods": periodos, "data": filas}

    def gasto_por_categoria(self, zid, sid, desde, hasta):
        return [{"categoryId": 2, "categoryName": "Lácteos", "totalSpend": 4644.0, "units": 90, "basketCount": 62,
                 "share": 42.28},
                {"categoryId": None, "categoryName": "Sin categoría", "totalSpend": 100.0, "units": 1,
                 "basketCount": 1, "share": 0.91}]


@pytest.fixture
def entorno():
    fuentes = FuentesFalsas()
    estado = {"rol": ROL.ANALISTA}
    app.dependency_overrides[sesion_actual] = lambda: {"id": "u-1", "rol": estado["rol"]}
    app.dependency_overrides[obtener_fuentes] = lambda: fuentes
    yield {"cliente": TestClient(app), "fuentes": fuentes, "estado": estado}
    app.dependency_overrides.clear()


def get(entorno, ruta, xml=False, **params):
    r = entorno["cliente"].get(ruta, params=params, headers={"Accept": "application/xml"} if xml else {})
    if xml:
        XSD.assertValid(etree.fromstring(r.content))
    return r


BASE = {"zoneId": ZONA, "segmentId": 2}
OCTUBRE = {**BASE, "dateFrom": "2026-10-01", "dateTo": "2026-10-31"}


# --- GET /v1/typical-basket

def test_canasta_tipica_con_la_frontera_del_20(entorno):
    r = get(entorno, "/v1/typical-basket", includeAll="true", **OCTUBRE)
    assert r.status_code == 200
    c = r.json()
    assert c["disponible"] is True and c["motivo"] is None
    assert c["group"]["segment"] == {"id": 2, "code": "ING_2", "name": "Ingreso medio", "versions": [1]}
    assert [(p["productId"], p["typical"]) for p in c["products"]][-2:] == [("p-05", True), ("p-06", False)]
    assert c["typicalSize"] == 5
    assert c["summary"]["basketsPerWeek"] == 100 / (31 / 7)
    assert c["products"][-1]["categoryName"] == "Sin categoría"
    assert c["dataVersion"]["source"] == "core-process-service" and len(c["dataVersion"]["sha256"]) == 64
    assert get(entorno, "/v1/typical-basket", xml=True, includeAll="true", **OCTUBRE).status_code == 200


def test_sin_include_all_solo_los_tipicos(entorno):
    c = get(entorno, "/v1/typical-basket", **OCTUBRE).json()
    assert [p["productId"] for p in c["products"]] == ["p-01", "p-02", "p-03", "p-04", "p-05"]


def test_d36_no_disponible_sin_numeros_y_xml_valido(entorno):
    entorno["fuentes"].tiendas = 2
    c = get(entorno, "/v1/typical-basket", **OCTUBRE).json()
    assert c["disponible"] is False
    assert c["motivo"] == "La combinación zona-segmento tiene 2 tiendas (mínimo 3) con 100 canastas (D-36, regla ambos)."
    assert c["coverage"] == {"baskets": 100, "stores": 2}
    assert (c["summary"], c["products"], c["typicalSize"], c["dataVersion"], c["assumptions"]) == (None, None, None, None, [])
    get(entorno, "/v1/typical-basket", xml=True, **OCTUBRE)


def test_grupo_sin_canastas_es_200_no_404(entorno):
    entorno["fuentes"].vacios.add(None)
    r = get(entorno, "/v1/typical-basket", **OCTUBRE)
    assert r.status_code == 200
    assert (r.json()["disponible"], r.json()["coverage"]) == (False, {"baskets": 0, "stores": 0})
    get(entorno, "/v1/typical-basket", xml=True, **OCTUBRE)


def test_sin_fechas_las_semanas_salen_de_las_semanas_con_canastas(entorno):
    c = get(entorno, "/v1/typical-basket", **BASE).json()
    semanal = entorno["fuentes"].pedidas[-1]
    assert semanal["groupBy"] == "week" and semanal["asOf"] == AS_OF  # misma instantánea
    # La falsa devuelve semanas del 2026-08-31 (lunes) al 2026-10-26 (lunes): 9 semanas.
    assert c["summary"]["basketsPerWeek"] == 100 / 9
    assert any("primera a la última semana" in s for s in c["assumptions"])
    get(entorno, "/v1/typical-basket", xml=True, **BASE)


def test_as_of_se_respeta_y_repetir_da_lo_mismo(entorno):
    instante = "2026-11-20T00:00:00Z"
    a = get(entorno, "/v1/typical-basket", asOf=instante, **OCTUBRE).json()
    b = get(entorno, "/v1/typical-basket", asOf=instante, **OCTUBRE).json()
    assert entorno["fuentes"].pedidas[-1]["asOf"] == instante
    assert a == b and a["asOf"] == instante


# --- GET /v1/typical-basket/compare

COMPARA = {**BASE, "periodAFrom": "2026-09-01", "periodATo": "2026-09-30",
           "periodBFrom": "2026-10-01", "periodBTo": "2026-10-31"}


def test_comparacion_disponible_en_la_misma_instantanea(entorno):
    r = get(entorno, "/v1/typical-basket/compare", **COMPARA)
    assert r.status_code == 200
    c = r.json()
    assert c["disponible"] is True
    assert {i["indicator"] for i in c["indicators"]} == {"averageTicket", "productsPerBasket", "typicalSize"}
    assert len(c["staying"]) == 5 and c["entering"] == [] and c["leaving"] == []
    a, b = entorno["fuentes"].pedidas[-2:]
    assert a["asOf"] is None and b["asOf"] == AS_OF  # B usa el asOf que fijó A
    get(entorno, "/v1/typical-basket/compare", xml=True, **COMPARA)


def test_comparacion_con_un_periodo_no_publicable(entorno):
    entorno["fuentes"].tiendas = 2
    c = get(entorno, "/v1/typical-basket/compare", **COMPARA).json()
    assert c["disponible"] is False
    assert c["motivo"].startswith("Periodo A: La combinación zona-segmento tiene 2 tiendas")
    assert c["periodA"]["disponible"] is False and c["periodB"]["coverage"]["stores"] == 2
    assert (c["entering"], c["leaving"], c["staying"], c["indicators"]) == (None, None, None, None)
    get(entorno, "/v1/typical-basket/compare", xml=True, **COMPARA)


# --- GET /v1/basket-evolution

def test_evolucion_mensual_sin_huecos_y_con_bordes_parciales(entorno):
    f = entorno["fuentes"]
    f.chicos.add("2026-08-01")
    f.vacios.add("2026-09-01")
    r = get(entorno, "/v1/basket-evolution", dateFrom="2026-08-15", dateTo="2026-10-10", **BASE)
    assert r.status_code == 200
    datos = r.json()["data"]
    assert [(p["periodStart"], p["periodEnd"]) for p in datos] == [
        ("2026-08-15", "2026-08-31"), ("2026-09-01", "2026-09-30"), ("2026-10-01", "2026-10-10")]
    assert [p["disponible"] for p in datos] == [False, False, True]
    assert "9 transacciones (mínimo 10)" in datos[0]["motivo"]
    assert datos[1]["coverage"] == {"baskets": 0, "stores": 0} and datos[1]["averageTicket"] is None
    assert datos[2]["typicalSize"] == 5 and datos[2]["averageTicket"] > 0
    get(entorno, "/v1/basket-evolution", xml=True, dateFrom="2026-08-15", dateTo="2026-10-10", **BASE)


def test_evolucion_semanal(entorno):
    r = get(entorno, "/v1/basket-evolution", dateFrom="2026-11-04", dateTo="2026-11-18", granularity="week", **BASE)
    assert [p["periodStart"] for p in r.json()["data"]] == ["2026-11-04", "2026-11-09", "2026-11-16"]
    assert entorno["fuentes"].pedidas[-1]["groupBy"] == "week"


@pytest.mark.parametrize("params", [
    {"dateFrom": "2023-11-01", "dateTo": "2026-11-30"},                         # 37 meses
    {"dateFrom": "2024-11-25", "dateTo": "2026-11-29", "granularity": "week"},  # 105 semanas
    {"dateFrom": "2026-10-01"},                                                  # falta dateTo
    {"dateFrom": "2026-10-01", "dateTo": "2026-10-31", "granularity": "day"},
])
def test_evolucion_400(entorno, params):
    assert get(entorno, "/v1/basket-evolution", **BASE, **params).status_code == 400


# --- GET /v1/category-mix

def test_mezcla_por_categoria(entorno):
    c = get(entorno, "/v1/category-mix", **OCTUBRE).json()
    assert c["disponible"] is True and c["coverage"] == {"baskets": 100, "stores": 4}
    assert c["data"][0] == {"categoryId": 2, "categoryName": "Lácteos", "totalSpend": 4644.0, "basketCount": 62,
                            "share": 42.28}
    assert "units" not in c["data"][0]
    get(entorno, "/v1/category-mix", xml=True, **OCTUBRE)


def test_mezcla_no_disponible_sin_datos(entorno):
    entorno["fuentes"].canastas = 9
    c = get(entorno, "/v1/category-mix", **OCTUBRE).json()
    assert c["disponible"] is False and c["data"] is None
    get(entorno, "/v1/category-mix", xml=True, **OCTUBRE)


# --- Validación de la consulta (400)

@pytest.mark.parametrize("ruta, params", [
    ("/v1/typical-basket", {"segmentId": 2}),                                         # falta zoneId
    ("/v1/typical-basket", {"zoneId": ZONA}),                                         # falta segmentId
    ("/v1/typical-basket", {"zoneId": "no-uuid", "segmentId": 2}),
    ("/v1/typical-basket", {**BASE, "segmentId": 0}),
    ("/v1/typical-basket", {**BASE, "segmentId": "abc"}),
    ("/v1/typical-basket", {**BASE, "dateFrom": "01/10/2026"}),
    ("/v1/typical-basket", {**BASE, "dateFrom": "2026-11-01", "dateTo": "2026-10-01"}),
    ("/v1/typical-basket", {**BASE, "asOf": "ayer"}),
    ("/v1/typical-basket", {**BASE, "asOf": "2026-11-20T00:00:00"}),                  # sin zona horaria
    ("/v1/typical-basket", {**BASE, "storeId": "x"}),                                 # parámetro desconocido
    ("/v1/typical-basket/compare", {k: v for k, v in COMPARA.items() if k != "periodBTo"}),
    ("/v1/typical-basket/compare", {**COMPARA, "periodAFrom": "2026-10-01", "periodATo": "2026-09-01"}),
    ("/v1/category-mix", {**BASE, "asOf": "2026-11-20T00:00:00Z"}),                   # no acepta asOf
])
def test_consulta_invalida_da_400(entorno, ruta, params):
    r = get(entorno, ruta, **params)
    assert r.status_code == 400
    assert r.json()["code"] == "VALIDATION_ERROR"


def test_zona_o_segmento_inexistente_404_en_xml(entorno):
    for falta in ("zona", "segmento"):
        entorno["fuentes"].falta = falta
        r = get(entorno, "/v1/typical-basket", xml=True, **OCTUBRE)
        assert r.status_code == 404


def test_core_caido_503(entorno):
    entorno["fuentes"].falta = "core"
    assert get(entorno, "/v1/basket-evolution", xml=True, **OCTUBRE).status_code == 503


# --- Permisos (Matriz §3.2): los 6 perfiles internos leen; Proveedor e Investigador no

@pytest.mark.parametrize("rol", TODOS_LOS_ROLES)
def test_permisos_por_rol(entorno, rol):
    entorno["estado"]["rol"] = rol
    esperado = 200 if rol in PERFILES_INTERNOS else 403
    assert get(entorno, "/v1/typical-basket", **OCTUBRE).status_code == esperado
    assert get(entorno, "/v1/typical-basket/compare", **COMPARA).status_code == esperado
    assert get(entorno, "/v1/basket-evolution", **OCTUBRE).status_code == esperado
    assert get(entorno, "/v1/category-mix", **OCTUBRE).status_code == esperado


def test_sin_sesion_401_en_xml(entorno):
    app.dependency_overrides.pop(sesion_actual)
    assert get(entorno, "/v1/typical-basket", xml=True, **OCTUBRE).status_code == 401


# --- Swagger

def test_swagger_trae_ejemplos_json_y_xml_validos():
    rutas = TestClient(app).get("/openapi.json").json()["paths"]
    for ruta in ("/v1/typical-basket", "/v1/typical-basket/compare", "/v1/basket-evolution", "/v1/category-mix"):
        respuestas = rutas[ruta]["get"]["responses"]
        assert "example" in respuestas["200"]["content"]["application/json"]
        for status in ("200", "400", "401", "403", "404", "503"):
            XSD.assertValid(etree.fromstring(respuestas[status]["content"]["application/xml"]["example"].encode()))
