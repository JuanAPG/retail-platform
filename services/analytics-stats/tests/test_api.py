"""STA-02 y STA-04 por HTTP: roles (D-24), 401, errores estándar en JSON y
XML, y que el XML de cada ruta valide contra su XSD.

La sesión (JWT + Redis) se simula sustituyendo `sesion_actual`; la prueba de
401 usa la real, que rechaza antes de consultar Redis.
"""
import pathlib

import pytest
from fastapi.testclient import TestClient
from scipy import stats

from app.auth_session import sesion_actual
from app.main import app
from app.roles import ROL

XSD = pathlib.Path(__file__).resolve().parents[3] / "docs" / "contratos" / "analytics-stats.xsd"
ALTO = [142.0, 170.5, 142.0, 170.5, 98.0, 120.0, 155.5, 133.0, 160.0, 149.5]
BAJO = [108.0, 36.0, 72.0, 55.5, 90.0, 61.0, 80.5, 47.0, 66.0, 73.5]

CUERPOS = {
    "/v1/hypothesis/test": {"groups": [{"label": "Ingreso alto", "values": ALTO},
                                       {"label": "Ingreso bajo", "values": BAJO}]},
    "/v1/anova": {"groups": [{"label": "Ingreso alto", "values": ALTO}, {"label": "Ingreso bajo", "values": BAJO},
                             {"label": "Ingreso medio", "values": [v + 20 for v in BAJO]}]},
    "/v1/proportions/compare": {"groups": [{"label": "Ingreso alto", "successes": 30, "total": 42},
                                           {"label": "Ingreso bajo", "successes": 12, "total": 30}]},
}
XML = {"Accept": "application/xml"}


def con_rol(rol: str) -> TestClient:
    app.dependency_overrides[sesion_actual] = lambda: {"id": "u-1", "email": "x@retail.mx", "rol": rol, "rolId": 1}
    return TestClient(app)


@pytest.fixture(autouse=True)
def sin_sustituciones():
    yield
    app.dependency_overrides.clear()


@pytest.fixture(scope="module")
def esquema():
    xmlschema = pytest.importorskip("xmlschema")
    if not XSD.exists():
        pytest.skip(f"No está el XSD del contrato ({XSD}): corre las pruebas desde el repo completo.")
    return xmlschema.XMLSchema(str(XSD))


def test_el_analista_obtiene_el_resultado_de_scipy():
    r = con_rol(ROL.ANALISTA).post("/v1/hypothesis/test", json=CUERPOS["/v1/hypothesis/test"])

    assert r.status_code == 200
    cuerpo = r.json()
    ref = stats.ttest_ind(ALTO, BAJO, equal_var=False)
    assert cuerpo["test"] == "welch" and abs(cuerpo["statistic"] - ref.statistic) < 1e-9
    assert cuerpo["source"] is None


@pytest.mark.parametrize("ruta", list(CUERPOS))
def test_xml_de_cada_ruta_valida_contra_el_xsd(ruta, esquema):
    r = con_rol(ROL.ANALISTA).post(ruta, json=CUERPOS[ruta], headers=XML)

    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/xml")
    esquema.validate(r.text)


@pytest.mark.parametrize("ruta", list(CUERPOS))
@pytest.mark.parametrize("rol", [ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA, ROL.RESPONSABLE_PRECIOS,
                                 ROL.PLANEADOR, ROL.AUDITOR, ROL.PROVEEDOR])
def test_solo_el_analista_ejecuta_d24(ruta, rol):
    r = con_rol(rol).post(ruta, json=CUERPOS[ruta])

    assert r.status_code == 403
    assert r.json()["code"] == "FORBIDDEN"


@pytest.mark.parametrize("ruta", list(CUERPOS))
def test_sin_token_es_401(ruta):
    r = TestClient(app).post(ruta, json=CUERPOS[ruta])

    assert r.status_code == 401
    assert r.json()["code"] == "UNAUTHORIZED"


def test_valor_no_numerico_es_400_en_json_y_en_xml(esquema):
    cuerpo = {"groups": [{"label": "A", "values": [1, "abc"]}, {"label": "B", "values": [2, 3]}]}
    cliente = con_rol(ROL.ANALISTA)

    r = cliente.post("/v1/hypothesis/test", json=cuerpo)
    assert r.status_code == 400
    error = r.json()
    assert error["code"] == "VALIDATION_ERROR"
    # Como el ValidationPipe de Nest: details es una lista de textos.
    assert all(isinstance(d, str) for d in error["details"])
    assert error["details"][0].startswith("groups.0.values.1:")

    xml = cliente.post("/v1/hypothesis/test", json=cuerpo, headers=XML)
    assert xml.status_code == 400
    esquema.validate(xml.text)


@pytest.mark.parametrize("valor", ["NaN", "Infinity", "true", '"5"'])
def test_nan_infinito_booleano_o_texto_es_400_y_no_500(valor):
    crudo = '{"groups": [{"label": "A", "values": [1, %s]}, {"label": "B", "values": [2, 3]}]}' % valor

    r = con_rol(ROL.ANALISTA).post("/v1/hypothesis/test", content=crudo,
                                    headers={"Content-Type": "application/json"})

    assert r.status_code == 400
    assert r.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("ruta,cuerpo,mensaje", [
    ("/v1/hypothesis/test", {"groups": [{"label": "A", "values": [1]}, {"label": "B", "values": [2, 3]}]}, "al menos 2"),
    ("/v1/hypothesis/test", {**CUERPOS["/v1/hypothesis/test"], "extra": 1}, None),
    ("/v1/hypothesis/test", {**CUERPOS["/v1/hypothesis/test"], "alpha": 1}, None),
    ("/v1/anova", {"groups": [{"label": "A", "values": [1, 2]}]}, "al menos 2 grupos"),
    ("/v1/proportions/compare", {"groups": [{"label": "A", "successes": 5, "total": 4},
                                            {"label": "B", "successes": 1, "total": 4}]}, "entre 0 y el total"),
    ("/v1/proportions/compare", {"groups": [{"label": "A", "successes": 0, "total": 0},
                                            {"label": "B", "successes": 1, "total": 4}]}, "total 0"),
])
def test_casos_invalidos_son_400_con_su_motivo(ruta, cuerpo, mensaje):
    r = con_rol(ROL.ANALISTA).post(ruta, json=cuerpo)

    assert r.status_code == 400
    assert r.json()["code"] == "VALIDATION_ERROR"
    if mensaje:
        assert mensaje in r.json()["message"]


def test_anova_con_dos_grupos_responde_la_prueba_de_dos_grupos():
    cuerpo = {"groups": CUERPOS["/v1/hypothesis/test"]["groups"]}

    r = con_rol(ROL.ANALISTA).post("/v1/anova", json=cuerpo)

    assert r.status_code == 200
    assert r.json()["test"] == "welch" and r.json()["dfBetween"] is None


@pytest.mark.parametrize("ruta", list(CUERPOS))
def test_swagger_documenta_ejemplo_json_y_xml_y_sus_errores(ruta, esquema):
    operacion = TestClient(app).get("/openapi.json").json()["paths"][ruta]["post"]

    exito = operacion["responses"]["200"]["content"]
    assert exito["application/json"]["example"]
    esquema.validate(exito["application/xml"]["example"])
    for estado in ("400", "401", "403", "503"):
        esquema.validate(operacion["responses"][estado]["content"]["application/xml"]["example"])
