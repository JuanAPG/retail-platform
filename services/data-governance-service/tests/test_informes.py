"""Lecturas de los dueños (ingestion, core-process, availability, income-segmentation) con un
transporte HTTP falso, y el reporte de calidad y la evaluación de retención que se arman con ellas."""
from datetime import date

import httpx
import pytest

from app.correlacion import fijar, soltar
from app.fuentes import Fuentes, SinDueno
from app.informes import evaluacion, reporte_calidad

HOY = date(2026, 11, 25)
POLITICAS = [{"dataset": d, "ownerService": s, "retentionPeriod": p} for d, s, p in [
    ("transacciones", "core-process-service", "P3Y"), ("capturas_disponibilidad", "availability-service", "P1Y"),
    ("observaciones_precio", "pricing-service", "P1Y"), ("visitas_campo", "catalog-service", "P1Y"),
    ("notificaciones", "notifications-service", "P90D"), ("bitacora", "audit-service", None)]]
REGISTRADAS = {"ventas-archivo": {"name": "Importación de ventas", "ownerService": "transactions-ingestion-service"},
               "capturas-campo": {"name": "Capturas de campo", "ownerService": "availability-service"},
               "inegi-enigh": {"name": "INEGI ENIGH", "ownerService": "income-segmentation-service"}}


def lote(id_, state, creado, valid, repeated, rejected, conflicts):
    return {"id": id_, "state": state, "createdAt": creado,
            "counts": {"valid": valid, "repeated": repeated, "rejected": rejected, "conflicts": conflicts}}


LOTES = [  # del más reciente al más viejo, como ingestion
    lote("l4", "vista_previa", "2026-11-24T18:00:00Z", 10, 0, 0, 0),
    lote("l3", "confirmado", "2026-11-23T19:00:00Z", 150, 2, 3, 1),
    lote("l2", "descartado", "2026-11-10T15:00:00Z", 999, 0, 99, 0),     # descartado: no cuenta
    lote("l1", "confirmado", "2026-11-05T06:30:00Z", 85, 1, 2, 0),       # 00:30 en Monterrey
    lote("l0", "confirmado", "2026-10-20T12:00:00Z", 50, 0, 0, 0),       # fuera de la ventana
]
FILAS = {"l3": [("rechazada", "CANTIDAD_INVALIDA"), ("rechazada", "FECHA_VACIA"), ("rechazada", "PRECIO_INVALIDO"),
                ("valida", None), ("repetida", None)],
         "l1": [("rechazada", "PRECIO_INVALIDO"), ("rechazada", "SKU_NO_EXISTE"), ("valida", None)]}


class Duenos:
    """Imita a los cuatro dueños. `caidos`: servicios que no responden; `prohibidos`: que dan 403."""

    def __init__(self):
        self.caidos, self.prohibidos, self.pedidas = set(), set(), []
        self.transporte = httpx.MockTransport(self.responder)

    def responder(self, peticion: httpx.Request) -> httpx.Response:
        self.pedidas.append(peticion)
        host, ruta, p = peticion.url.host, peticion.url.path, dict(peticion.url.params)
        if host in self.caidos:
            raise httpx.ConnectTimeout("lento")
        if host in self.prohibidos:
            return httpx.Response(403, json={"message": "Tu rol no tiene permiso."})
        if ruta == "/v1/transaction-imports":
            return _pagina(LOTES, p)
        if ruta.endswith("/rows"):
            filas = [{"row": i + 1, "status": s, "code": c} for i, (s, c) in enumerate(FILAS[ruta.split("/")[3]])]
            return _pagina(filas, p)
        if ruta == "/v1/availability/captures":
            return httpx.Response(200, json={"data": [], "total": 3 if p.get("status") == "conflicto" else 48})
        if ruta == "/v1/availability/stock":
            return httpx.Response(200, json={"data": [], "total": 11 if p.get("status") == "vencido" else 40})
        if ruta == "/v1/segments":
            return _pagina([{"id": i, "versionValidFrom": f"2026-09-{24 + i:02d}T12:00:00Z"} for i in range(3)], p)
        if ruta == "/v1/transactions":
            return httpx.Response(200, json={"data": [], "total": 56 if p.get("dateTo") == "2026-09-01" else 0})
        return httpx.Response(404, json={"message": "Not found"})


def _pagina(filas, params):
    pagina, limite = int(params.get("page", 1)), int(params["limit"])
    return httpx.Response(200, json={"data": filas[(pagina - 1) * limite:pagina * limite], "total": len(filas),
                                     "page": pagina, "limit": limite})


@pytest.fixture
def duenos(monkeypatch):
    for variable, host in [("INGESTION_SERVICE_URL", "ingestion"), ("CORE_PROCESS_SERVICE_URL", "core"),
                           ("AVAILABILITY_SERVICE_URL", "availability"), ("INCOME_SEGMENTATION_SERVICE_URL", "segmentos")]:
        monkeypatch.setenv(variable, f"http://{host}")
    d = Duenos()
    d.fuentes = Fuentes("Bearer tok", httpx.Client(transport=d.transporte))
    return d


def metricas(fuente):
    return {m["metric"]: m for m in fuente["metrics"]}


# --- Lecturas

def test_lotes_de_la_ventana_sin_descartados_y_ultimo_confirmado(duenos):
    lotes, ultimo = duenos.fuentes.lotes(date(2026, 11, 1), date(2026, 11, 25))
    assert [l["id"] for l in lotes] == ["l4", "l3", "l1"]
    assert ultimo == date(2026, 11, 23)
    # 06:30 UTC del 5-nov es 00:30 en Monterrey: cae en la ventana que empieza el 5.
    assert [l["id"] for l in duenos.fuentes.lotes(date(2026, 11, 5), date(2026, 11, 5))[0]] == ["l1"]


def test_rechazos_por_codigo_solo_de_los_lotes_con_rechazos(duenos):
    lotes, _ = duenos.fuentes.lotes(date(2026, 11, 1), None)
    assert duenos.fuentes.rechazos(lotes) == {"CANTIDAD_INVALIDA": 1, "FECHA_VACIA": 1, "PRECIO_INVALIDO": 2,
                                              "SKU_NO_EXISTE": 1}
    filas_pedidas = {p.url.path for p in duenos.pedidas if p.url.path.endswith("/rows")}
    assert filas_pedidas == {"/v1/transaction-imports/l3/rows", "/v1/transaction-imports/l1/rows"}  # l4 no tiene rechazos


def test_reenvia_token_y_correlacion(duenos):
    token = fijar("op-gobierno-1")
    try:
        duenos.fuentes.transacciones_hasta(date(2026, 9, 1))
    finally:
        soltar(token)
    encabezados = duenos.pedidas[-1].headers
    assert (encabezados["authorization"], encabezados["x-correlation-id"]) == ("Bearer tok", "op-gobierno-1")
    assert dict(duenos.pedidas[-1].url.params) == {"dateTo": "2026-09-01", "limit": "1"}


@pytest.mark.parametrize("como, texto", [("caidos", "no respondió en 3 s"), ("prohibidos", "no da lectura a este rol")])
def test_dueno_caido_o_prohibido_lanza_sin_dueno_con_motivo(duenos, como, texto):
    getattr(duenos, como).add("availability")
    with pytest.raises(SinDueno) as error:
        duenos.fuentes.capturas()
    assert "availability-service" in error.value.motivo and texto in error.value.motivo


def test_dueno_sin_configurar(duenos, monkeypatch):
    monkeypatch.delenv("CORE_PROCESS_SERVICE_URL")
    with pytest.raises(SinDueno) as error:
        duenos.fuentes.transacciones_hasta(date(2026, 9, 1))
    assert "no está configurado (CORE_PROCESS_SERVICE_URL)" in error.value.motivo


# --- Reporte de calidad (DG-7)

def test_reporte_de_calidad_como_el_ejemplo_del_contrato(duenos):
    r = reporte_calidad(REGISTRADAS, duenos.fuentes, date(2026, 11, 1), date(2026, 11, 25), None, HOY,
                        "2026-11-26T09:15:00+00:00", 7, 365)
    ventas, capturas, enigh = r["sources"]

    assert [s["sourceKey"] for s in r["sources"]] == ["ventas-archivo", "capturas-campo", "inegi-enigh"]
    m = metricas(ventas)
    assert ventas["sampleSize"] == 254  # 10 + 156 + 88
    assert (m["completeness"]["numerator"], m["completeness"]["denominator"]) == (253, 254)
    assert (m["duplicates"]["numerator"], m["outOfRange"]["numerator"]) == (4, 4)
    assert (m["freshness"]["value"], m["freshness"]["stale"]) == (2.0, False)
    assert metricas(capturas)["duplicates"]["value"] == 3 / 48
    assert metricas(capturas)["freshness"]["value"] == 29 / 40
    assert (enigh["sampleSize"], metricas(enigh)["freshness"]["value"]) == (3, 62.0)


def test_un_dueno_caido_no_tumba_el_reporte(duenos):
    duenos.caidos.add("availability")
    r = reporte_calidad(REGISTRADAS, duenos.fuentes, None, None, None, HOY, "x", 7, 365)
    capturas = r["sources"][1]
    assert all(m["disponible"] is False and m["value"] is None for m in capturas["metrics"])
    assert "availability-service no respondió" in capturas["metrics"][1]["motivo"]
    assert metricas(r["sources"][0])["duplicates"]["disponible"] is True  # las demás fuentes sí se miden
    assert metricas(r["sources"][2])["freshness"]["disponible"] is True


def test_auditor_sin_lectura_en_ingestion(duenos):
    duenos.prohibidos.add("ingestion")
    ventas = reporte_calidad(REGISTRADAS, duenos.fuentes, None, None, "ventas-archivo", HOY, "x", 7, 365)["sources"]
    assert len(ventas) == 1
    assert {m["motivo"] for m in ventas[0]["metrics"]} == {
        "transactions-ingestion-service no da lectura a este rol (pedido en el contrato)."}


# --- Evaluación de retención (DG-10)

def test_evaluacion_como_el_ejemplo_del_contrato(duenos):
    r = evaluacion(POLITICAS, duenos.fuentes, date(2029, 9, 1))
    por_conjunto = {d["dataset"]: d for d in r["data"]}

    assert por_conjunto["transacciones"] == {"dataset": "transacciones", "ownerService": "core-process-service",
                                             "retentionPeriod": "P3Y", "cutoffDate": "2026-09-01",
                                             "expiredCount": 56, "disponible": True, "motivo": None}
    assert por_conjunto["notificaciones"]["cutoffDate"] == "2029-06-03"
    for conjunto in ("capturas_disponibilidad", "observaciones_precio", "visitas_campo", "notificaciones"):
        assert (por_conjunto[conjunto]["disponible"], por_conjunto[conjunto]["expiredCount"]) == (False, None)
    assert por_conjunto["bitacora"] | {} == {"dataset": "bitacora", "ownerService": "audit-service",
                                             "retentionPeriod": None, "cutoffDate": None, "expiredCount": None,
                                             "disponible": True, "motivo": "Sin borrado: nunca vence (D-43)."}


def test_evaluacion_con_core_caido_no_es_cero(duenos):
    duenos.caidos.add("core")
    fila = evaluacion(POLITICAS, duenos.fuentes, date(2029, 9, 1))["data"][0]
    assert (fila["disponible"], fila["expiredCount"]) == (False, None)
    assert "core-process-service no respondió" in fila["motivo"]
