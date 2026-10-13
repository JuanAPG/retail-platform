"""Modo `baskets` (contrato: *De dónde salen los datos*): los valores salen de
`GET /v1/baskets` de core-process y los nombres de catalog, por HTTP.

core-process y catalog se simulan con `httpx.MockTransport`: la prueba ve cada
petición que hace el servicio (filtros, páginas, token).
"""
import pathlib
import uuid

import httpx
import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from scipy import stats
from statsmodels.stats.proportion import proportions_ztest

from app.auth_session import sesion_actual
from app.fuentes import Fuentes, obtener_fuentes
from app.main import app
from app.roles import ROL

XSD = pathlib.Path(__file__).resolve().parents[3] / "docs" / "contratos" / "analytics-stats.xsd"
TOKEN = "Bearer token-del-analista"
ZONA_A, ZONA_B, ZONA_C = (str(uuid.UUID(int=n)) for n in (1, 2, 3))


def canasta(n: int, total: float) -> dict:
    """Como la devuelve core-process: importes como texto (numeric de Postgres)."""
    return {"totalValue": f"{total:.2f}", "productCount": 1 + n % 4, "unitsTotal": f"{2 + n % 5:.2f}",
            "hasBasicProducts": n % 3 != 0, "size": ("chica", "mediana", "grande")[n % 3]}


class Servicios:
    """core-process y catalog falsos. `totales` permite simular volúmenes sin datos."""

    def __init__(self, canastas: dict[str, list[dict]], nombres: dict[str, str], totales: dict[str, int] | None = None,
                 falla: Exception | None = None, estado: int | None = None):
        self.canastas, self.nombres, self.totales = canastas, nombres, totales or {}
        self.falla, self.estado = falla, estado
        self.peticiones: list[httpx.Request] = []

    def __call__(self, peticion: httpx.Request) -> httpx.Response:
        self.peticiones.append(peticion)
        if self.falla:
            raise self.falla
        if self.estado:
            return httpx.Response(self.estado, json={"message": "falla simulada"})
        ruta, params = peticion.url.path, peticion.url.params
        if ruta.startswith(("/v1/segments/", "/v1/zones/")):
            gid = ruta.rsplit("/", 1)[1]
            if gid not in self.nombres:
                return httpx.Response(404, json={"message": "No existe."})
            campo = "name" if ruta.startswith("/v1/segments/") else "nombre"
            return httpx.Response(200, json={"id": gid, campo: self.nombres[gid]})
        assert ruta == "/v1/baskets", ruta
        gid = params.get("segmentId") or params.get("zoneId")
        filas = self.canastas.get(gid, [])
        if "hasBasicProducts" in params:
            filas = [f for f in filas if f["hasBasicProducts"] == (params["hasBasicProducts"] == "true")]
        if "size" in params:
            filas = [f for f in filas if f["size"] == params["size"]]
        pagina, limite = int(params["page"]), int(params["limit"])
        total = self.totales.get(gid, len(filas))
        return httpx.Response(200, json={"data": filas[(pagina - 1) * limite: pagina * limite],
                                         "total": total, "page": pagina, "limit": limite})

    def de_canastas(self, pagina: int | None = None) -> list[httpx.Request]:
        return [p for p in self.peticiones if p.url.path == "/v1/baskets"
                and (pagina is None or p.url.params["page"] == str(pagina))]


ALTO = [canasta(n, 120 + (n * 7) % 60) for n in range(150)]   # 2 páginas
BAJO = [canasta(n, 60 + (n * 5) % 40) for n in range(40)]
MEDIO = [canasta(n, 90 + (n * 3) % 30) for n in range(35)]
SEGMENTOS = Servicios({"3": ALTO, "1": BAJO, "2": MEDIO},
                      {"3": "Ingreso alto", "1": "Ingreso bajo", "2": "Ingreso medio"})


def cliente(servicios: Servicios) -> TestClient:
    def fuentes_falsas(request: Request):
        with httpx.Client(transport=httpx.MockTransport(servicios)) as http:
            yield Fuentes(request.headers.get("authorization"), http)

    servicios.peticiones.clear()
    app.dependency_overrides[sesion_actual] = lambda: {"id": "u-1", "rol": ROL.ANALISTA}
    app.dependency_overrides[obtener_fuentes] = fuentes_falsas
    return TestClient(app, headers={"Authorization": TOKEN})


@pytest.fixture(autouse=True)
def sin_sustituciones():
    yield
    app.dependency_overrides.clear()


def valores(filas: list[dict], metrica: str = "totalValue") -> list[float]:
    return [float(f[metrica]) for f in filas]


def test_hipotesis_con_canastas_por_segmento():
    servicios = Servicios(SEGMENTOS.canastas, SEGMENTOS.nombres)
    cuerpo = {"baskets": {"metric": "totalValue", "groupBy": "segment", "groupIds": ["3", "1"],
                          "dateFrom": "2026-08-01", "dateTo": "2026-09-30"}}

    r = cliente(servicios).post("/v1/hypothesis/test", json=cuerpo)

    assert r.status_code == 200, r.text
    resultado = r.json()
    ref = stats.ttest_ind(valores(ALTO), valores(BAJO), equal_var=False)
    assert abs(resultado["statistic"] - ref.statistic) < 1e-9
    assert [(g["label"], g["n"]) for g in resultado["groups"]] == [("Ingreso alto", 150), ("Ingreso bajo", 40)]
    assert "en el ticket entre Ingreso alto e Ingreso bajo" in resultado["conclusion"]
    assert resultado["source"] == {**cuerpo["baskets"], "condition": None, "storeId": None}
    # Leyó las dos páginas del segmento alto, con sus filtros, y reenvió el token en cada llamada.
    paginas = [(p.url.params["segmentId"], p.url.params["page"]) for p in servicios.de_canastas()]
    assert sorted(paginas) == [("1", "1"), ("3", "1"), ("3", "2")]
    assert all(p.url.params["dateFrom"] == "2026-08-01" for p in servicios.de_canastas())
    assert all(p.headers["authorization"] == TOKEN for p in servicios.peticiones)


@pytest.mark.parametrize("metrica", ["productCount", "unitsTotal"])
def test_cada_metrica_toma_su_campo(metrica):
    cuerpo = {"baskets": {"metric": metrica, "groupBy": "segment", "groupIds": ["3", "1"]}}

    r = cliente(Servicios(SEGMENTOS.canastas, SEGMENTOS.nombres)).post("/v1/hypothesis/test", json=cuerpo)

    assert r.status_code == 200
    ref = stats.ttest_ind(valores(ALTO, metrica), valores(BAJO, metrica), equal_var=False)
    assert abs(r.json()["statistic"] - ref.statistic) < 1e-9


def test_anova_por_zona_usa_el_nombre_de_catalog():
    servicios = Servicios({ZONA_A: ALTO, ZONA_B: BAJO, ZONA_C: MEDIO},
                          {ZONA_A: "Zona Valle", ZONA_B: "Zona Oriente", ZONA_C: "Zona Centro"})
    cuerpo = {"baskets": {"metric": "totalValue", "groupBy": "zone", "groupIds": [ZONA_A, ZONA_B, ZONA_C]}}

    r = cliente(servicios).post("/v1/anova", json=cuerpo)

    assert r.status_code == 200, r.text
    ref = stats.f_oneway(valores(ALTO), valores(BAJO), valores(MEDIO))
    assert abs(r.json()["statistic"] - ref.statistic) < 1e-9
    assert [g["label"] for g in r.json()["groups"]] == ["Zona Valle", "Zona Oriente", "Zona Centro"]
    assert all("zoneId" in p.url.params for p in servicios.de_canastas())


@pytest.mark.parametrize("condicion,filtro", [("hasBasicProducts", ("hasBasicProducts", "true")),
                                              ("grande", ("size", "grande"))])
def test_proporciones_cuentan_con_los_totales(condicion, filtro):
    servicios = Servicios(SEGMENTOS.canastas, SEGMENTOS.nombres)
    cuerpo = {"baskets": {"condition": condicion, "groupBy": "segment", "groupIds": ["3", "1"]}}

    r = cliente(servicios).post("/v1/proportions/compare", json=cuerpo)

    assert r.status_code == 200, r.text
    cumple = lambda filas: sum(1 for f in filas if f[filtro[0]] == (filtro[1] == "true" if filtro[0] == "hasBasicProducts" else filtro[1]))
    grupos = r.json()["groups"]
    assert [(g["successes"], g["total"]) for g in grupos] == [(cumple(ALTO), 150), (cumple(BAJO), 40)]
    z, p = proportions_ztest([cumple(ALTO), cumple(BAJO)], [150, 40])
    assert r.json()["test"] == "ztest" and abs(r.json()["pValue"] - p) < 1e-9
    # Solo conteos: limit=1, una petición sin y otra con la condición por grupo.
    assert {p.url.params["limit"] for p in servicios.de_canastas()} == {"1"}
    assert sum(filtro[0] in p.url.params for p in servicios.de_canastas()) == 2


def test_mas_de_500_paginas_es_400_sin_leer_el_resto():
    # 30 000 + 20 001 canastas = 300 + 201 páginas = 501 (D-27 b).
    servicios = Servicios({"3": ALTO[:100], "1": BAJO}, SEGMENTOS.nombres, totales={"3": 30_000, "1": 20_001})
    cuerpo = {"baskets": {"metric": "totalValue", "groupBy": "segment", "groupIds": ["3", "1"]}}

    r = cliente(servicios).post("/v1/hypothesis/test", json=cuerpo)

    assert r.status_code == 400
    assert r.json()["message"] == ("Hay 50001 canastas para esta prueba (501 páginas); el máximo es 500 páginas "
                                   "(50000 canastas, D-27). Acota con dateFrom, dateTo o storeId.")
    # Solo leyó la primera página de cada grupo: no descargó nada más.
    assert len(servicios.de_canastas()) == 2 and not servicios.de_canastas(pagina=2)


def test_exactamente_500_paginas_si_se_leen():
    filas = [canasta(n, 50 + n % 97) for n in range(25_000)]
    servicios = Servicios({"3": filas, "1": filas[::-1]}, SEGMENTOS.nombres)
    cuerpo = {"baskets": {"metric": "totalValue", "groupBy": "segment", "groupIds": ["3", "1"]}}

    r = cliente(servicios).post("/v1/hypothesis/test", json=cuerpo)

    assert r.status_code == 200
    assert len(servicios.de_canastas()) == 500


@pytest.mark.parametrize("falla,estado", [
    (httpx.ReadTimeout("lento"), None),
    (httpx.ConnectError("caído"), None),
    (None, 500),
])
def test_servicio_que_no_responde_es_503(falla, estado):
    cuerpo = {"baskets": {"metric": "totalValue", "groupBy": "segment", "groupIds": ["3", "1"]}}

    r = cliente(Servicios({}, {}, falla=falla, estado=estado)).post("/v1/hypothesis/test", json=cuerpo)

    assert r.status_code == 503
    assert r.json()["code"] == "SERVICE_UNAVAILABLE"


def test_grupo_inexistente_en_catalog_es_404():
    cuerpo = {"baskets": {"metric": "totalValue", "groupBy": "segment", "groupIds": ["3", "9"]}}

    r = cliente(Servicios(SEGMENTOS.canastas, SEGMENTOS.nombres)).post("/v1/hypothesis/test", json=cuerpo)

    assert r.status_code == 404
    assert r.json()["message"] == "No existe el segmento 9."


def test_grupo_con_una_sola_canasta_es_400_que_lo_nombra():
    servicios = Servicios({"3": ALTO, "1": BAJO[:1]}, SEGMENTOS.nombres)
    cuerpo = {"baskets": {"metric": "totalValue", "groupBy": "segment", "groupIds": ["3", "1"]}}

    r = cliente(servicios).post("/v1/hypothesis/test", json=cuerpo)

    assert r.status_code == 400
    assert "«Ingreso bajo»" in r.json()["message"]


BASE = {"metric": "totalValue", "groupBy": "segment", "groupIds": ["3", "1"]}


@pytest.mark.parametrize("ruta,cuerpo,mensaje", [
    ("/v1/hypothesis/test", {"groups": [{"label": "A", "values": [1, 2]}, {"label": "B", "values": [3, 4]}],
                             "baskets": BASE}, "exactamente uno de los dos"),
    ("/v1/hypothesis/test", {"alpha": 0.05}, "exactamente uno de los dos"),
    ("/v1/hypothesis/test", {"baskets": {**BASE, "groupIds": ["3", "1", "2"]}}, "exactamente 2 grupos"),
    ("/v1/anova", {"baskets": {**BASE, "groupIds": ["3"]}}, "de 2 a 20 grupos"),
    ("/v1/hypothesis/test", {"baskets": {k: v for k, v in BASE.items() if k != "metric"}}, "necesita `metric`"),
    ("/v1/hypothesis/test", {"baskets": {**BASE, "condition": "grande"}}, "`condition` no aplica"),
    ("/v1/proportions/compare", {"baskets": BASE}, "necesita `condition`"),
    ("/v1/hypothesis/test", {"baskets": {**BASE, "groupIds": ["3", "abc"]}}, "no es un id de segmento"),
    ("/v1/hypothesis/test", {"baskets": {**BASE, "groupIds": ["3", "40000"]}}, "no es un id de segmento"),
    ("/v1/hypothesis/test", {"baskets": {**BASE, "groupBy": "zone", "groupIds": [ZONA_A, "zona-1"]}},
     "no es un id de zona"),
    ("/v1/hypothesis/test", {"baskets": {**BASE, "groupIds": ["3", "3"]}}, "no puede repetir"),
    ("/v1/hypothesis/test", {"baskets": {**BASE, "dateFrom": "2026-02-30"}}, "dateFrom debe ser un día"),
    ("/v1/hypothesis/test", {"baskets": {**BASE, "dateTo": "2026-09"}}, "dateTo debe ser un día"),
    ("/v1/hypothesis/test", {"baskets": {**BASE, "dateFrom": "2026-09-30", "dateTo": "2026-08-01"}},
     "anterior a la inicial"),
    ("/v1/hypothesis/test", {"baskets": {**BASE, "storeId": "tienda-1"}}, "storeId"),
])
def test_peticiones_invalidas_son_400_sin_llamar_a_nadie(ruta, cuerpo, mensaje):
    servicios = Servicios(SEGMENTOS.canastas, SEGMENTOS.nombres)

    r = cliente(servicios).post(ruta, json=cuerpo)

    assert r.status_code == 400
    assert r.json()["code"] == "VALIDATION_ERROR"
    assert any(mensaje in d for d in r.json()["details"]), r.json()["details"]
    assert servicios.peticiones == []


def test_el_xml_con_source_valida_contra_el_xsd():
    xmlschema = pytest.importorskip("xmlschema")
    if not XSD.exists():
        pytest.skip("Sin el XSD del contrato: corre las pruebas desde el repo completo.")
    cuerpo = {"baskets": {**BASE, "dateFrom": "2026-08-01", "storeId": str(uuid.UUID(int=9))}}

    r = cliente(Servicios(SEGMENTOS.canastas, SEGMENTOS.nombres)).post(
        "/v1/hypothesis/test", json=cuerpo, headers={"Accept": "application/xml"})

    assert r.status_code == 200
    xmlschema.XMLSchema(str(XSD)).validate(r.text)
    assert "<source><metric>totalValue</metric>" in r.text
