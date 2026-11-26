"""Casos de control del contrato: retención (DG-9 a DG-11), calidad y frescura (DG-7, DG-8) y el
árbol de origen (DG-5, DG-6). Cálculo puro: sin base de datos ni HTTP."""
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app import calidad
from app.dominio import CLAVE_FUENTE, SERVICIOS, ErrorDominio, dias_frescura_segmentos, dias_frescura_ventas
from app.origen import construir
from app.retencion import fecha_de_corte, simular, sumar_plazo, vencido, vence

EJEMPLOS = Path(__file__).resolve().parents[3] / "docs/contratos/ejemplos"
PLAZOS = {"transacciones": "P3Y", "capturas_disponibilidad": "P1Y", "observaciones_precio": "P1Y",
          "visitas_campo": "P1Y", "notificaciones": "P90D", "bitacora": None}


# --- DG-1: catálogos

def test_clave_de_fuente_y_los_20_servicios():
    assert CLAVE_FUENTE.match("ventas-core-process") and CLAVE_FUENTE.match("abc")
    for mala in ("ab", "Mala_Clave", "con espacio", "x" * 41):
        assert not CLAVE_FUENTE.match(mala)
    assert len(SERVICIOS) == 20
    assert {"demand-forecast-service", "transactions-ingestion-service", "algorithms-core"} <= SERVICIOS


# --- DG-9: vencimiento

@pytest.mark.parametrize("dia, plazo, esperado", [
    (date(2023, 11, 25), "P3Y", date(2026, 11, 25)),
    (date(2024, 2, 29), "P3Y", date(2027, 3, 1)),     # 29 de febrero + 3 años → 1 de marzo
    (date(2024, 2, 29), "P4Y", date(2028, 2, 29)),    # cae en bisiesto: se queda
    (date(2024, 2, 29), "P1Y", date(2025, 3, 1)),
    (date(2026, 8, 27), "P90D", date(2026, 11, 25)),
    (date(2026, 1, 31), "P1M", date(2026, 3, 1)),     # 31 de enero + 1 mes → 1 de marzo
])
def test_vencimiento_en_calendario(dia, plazo, esperado):
    assert sumar_plazo(dia, plazo) == esperado


def test_vence_el_mismo_dia_y_la_bitacora_nunca():
    assert vencido(date(2023, 11, 25), "P3Y", date(2026, 11, 25)) is True
    assert vencido(date(2023, 11, 26), "P3Y", date(2026, 11, 25)) is False
    assert vence(date(2019, 1, 1), None) is None
    assert vencido(date(1990, 1, 1), None, date(2100, 1, 1)) is False


# --- DG-11: simulación (el ejemplo del contrato, tal cual)

def test_simulacion_reproduce_el_ejemplo_del_contrato():
    pedido = json.loads((EJEMPLOS / "data-governance-retention-simulation-request.json").read_text(encoding="utf-8"))
    esperado = json.loads((EJEMPLOS / "data-governance-retention-simulation.json").read_text(encoding="utf-8"))
    assert simular(date.fromisoformat(pedido["asOf"]), pedido["records"], PLAZOS) == esperado


@pytest.mark.parametrize("registros, texto", [
    ([], "de 1 a 1000"),
    ([{"dataset": "transacciones", "recordId": "x", "date": "2024-01-01"}] * 1001, "de 1 a 1000"),
    ([{"dataset": "ventas", "recordId": "x", "date": "2024-01-01"}], "dataset desconocido"),
])
def test_simulacion_invalida(registros, texto):
    with pytest.raises(ErrorDominio) as error:
        simular(date(2026, 11, 25), registros, PLAZOS)
    assert texto in error.value.mensaje and error.value.status == 400


# --- DG-10: corte de la evaluación

def test_corte_del_ejemplo_del_contrato():
    as_of = date(2029, 9, 1)
    assert fecha_de_corte(as_of, "P3Y") == date(2026, 9, 1)  # las ventas del 1-sep-2026 ya vencen
    assert fecha_de_corte(as_of, "P1Y") == date(2028, 9, 1)
    assert fecha_de_corte(as_of, "P90D") == date(2029, 6, 3)
    assert fecha_de_corte(as_of, None) is None


@pytest.mark.parametrize("plazo", ["P3Y", "P1Y", "P90D", "P1M"])
def test_corte_y_vencimiento_siempre_coinciden(plazo):
    """Propiedad: un dato cuenta en la evaluación (fecha ≤ corte) si y solo si está vencido (DG-9).
    Cubre bisiestos y fines de mes, en cuatro años de fechas de consulta."""
    for as_of in (date(2027, 2, 27) + timedelta(days=k) for k in range(0, 1461, 7)):
        corte = fecha_de_corte(as_of, plazo)
        for dia in (corte + timedelta(days=d) for d in (-3, -2, -1, 0, 1, 2, 3)):
            assert (dia <= corte) == vencido(dia, plazo, as_of), (plazo, as_of, dia)


# --- DG-7 / DG-8: calidad y frescura

def lote(valid, repeated, rejected, conflicts):
    return {"counts": {"valid": valid, "repeated": repeated, "rejected": rejected, "conflicts": conflicts}}


def metricas(fuente):
    return {m["metric"]: m for m in fuente["metrics"]}


def test_ventas_archivo_reproduce_el_ejemplo_del_contrato():
    rechazos = {"CANTIDAD_INVALIDA": 1, "FECHA_VACIA": 1, "PRECIO_INVALIDO": 2, "SKU_NO_EXISTE": 1}
    r = calidad.ventas_archivo([lote(150, 2, 3, 1), lote(95, 1, 2, 0)], rechazos, None,
                               date(2026, 11, 23), date(2026, 11, 25), 7)
    m = metricas(r)

    assert r["sampleSize"] == 254
    assert (m["completeness"]["numerator"], m["completeness"]["denominator"]) == (253, 254)
    assert m["completeness"]["value"] == 253 / 254
    assert (m["duplicates"]["numerator"], m["outOfRange"]["numerator"]) == (4, 4)
    assert m["freshness"] | {} == {"metric": "freshness", "value": 2.0, "unit": "dias", "numerator": None,
                                   "denominator": None, "disponible": True, "motivo": None, "stale": False}
    assert r["rejectedByCode"][1] == {"code": "FECHA_VACIA", "count": 1}


def test_sin_rechazos_por_codigo_no_se_inventa_un_cero():
    m = metricas(calidad.ventas_archivo([lote(10, 0, 2, 0)], None, "ingestion no expone rejectedByCode.",
                                        date(2026, 11, 20), date(2026, 11, 25), 7))
    for nombre in ("completeness", "outOfRange"):
        assert (m[nombre]["disponible"], m[nombre]["value"]) == (False, None)
        assert m[nombre]["motivo"] == "ingestion no expone rejectedByCode."
    assert m["duplicates"]["disponible"] is True  # lo que sí se puede medir, se mide


def test_ventana_sin_filas_no_es_cero():
    m = metricas(calidad.ventas_archivo([], {}, None, None, date(2026, 11, 25), 7))
    assert all(x["disponible"] is False and x["value"] is None for x in m.values())


@pytest.mark.parametrize("dias, stale", [(7, False), (8, True)])
def test_frescura_de_ventas_7_y_8_dias(dias, stale):
    r = calidad.ventas_archivo([lote(1, 0, 0, 0)], {}, None, date(2026, 11, 25) - timedelta(days=dias),
                               date(2026, 11, 25), 7)
    assert metricas(r)["freshness"]["stale"] is stale


@pytest.mark.parametrize("dias, stale", [(365, False), (366, True)])
def test_frescura_de_segmentos_365_y_366_dias(dias, stale):
    hoy = date(2026, 11, 26)
    r = calidad.inegi_enigh([hoy - timedelta(days=10), hoy - timedelta(days=dias)], hoy, 365)
    assert (r["sampleSize"], metricas(r)["freshness"]["value"], metricas(r)["freshness"]["stale"]) == (2, float(dias), stale)


def test_capturas_de_campo_como_el_ejemplo():
    m = metricas(calidad.capturas_campo(48, 3, 40, 11, "Sobre todo el historial."))
    assert (m["duplicates"]["value"], m["duplicates"]["motivo"]) == (3 / 48, "Sobre todo el historial.")
    assert (m["freshness"]["numerator"], m["freshness"]["denominator"], m["freshness"]["value"]) == (29, 40, 0.725)
    assert m["completeness"]["disponible"] is False and m["outOfRange"]["disponible"] is False


def test_un_dueno_caido_deja_solo_su_fuente_sin_medir():
    r = calidad.fuente_caida(calidad.METRICAS, "availability-service no respondió en 3 s.")
    assert all(m["disponible"] is False and m["value"] is None for m in r["metrics"])
    assert {m["metric"] for m in r["metrics"]} == set(calidad.METRICAS)


def test_codigos_de_campo_vacio():
    assert calidad.es_campo_vacio("FECHA_VACIA") and calidad.es_campo_vacio("SKU_VACIO")
    assert not calidad.es_campo_vacio("FECHA_FUTURA") and not calidad.es_campo_vacio("VALOR_DEMASIADO_LARGO")


def test_umbrales_de_frescura_por_variable(monkeypatch):
    assert (dias_frescura_ventas(), dias_frescura_segmentos()) == (7, 365)
    monkeypatch.setenv("FRESHNESS_SALES_DAYS", "10")
    assert dias_frescura_ventas() == 10
    monkeypatch.setenv("FRESHNESS_SEGMENTS_DAYS", "0")
    with pytest.raises(ValueError):
        dias_frescura_segmentos()


# --- DG-5 / DG-6: árbol de origen

def registro(servicio, tipo, rid, usuario="u-1", insumos=()):
    return {"id": f"id-{rid}", "service": servicio, "resourceType": tipo, "resourceId": rid,
            "source": {"key": "ventas-core-process", "version": "v1"}, "userId": usuario,
            "inputs": [{"service": s, "resourceType": t, "resourceId": r} for s, t, r in insumos]}


def arbol(registros, raiz, usuario=None):
    indice = {(r["service"], r["resourceType"], r["resourceId"]): r for r in registros}
    return construir(raiz, indice.get, lambda r: usuario is None or r["userId"] == usuario,
                     lambda k: {"key": k}, lambda k, v: {"version": v})


LOTE = ("transactions-ingestion-service", "importacion", "lote-1")


def test_corrida_que_salio_de_un_lote_dos_niveles():
    corrida = registro("demand-forecast-service", "corrida", "c1", insumos=[LOTE])
    r = arbol([corrida, registro(*LOTE)], corrida)

    assert (r["depth"], r["truncated"]) == (2, False)
    hijo = r["root"]["inputs"][0]
    assert (hijo["registered"], hijo["restricted"], hijo["record"]["resourceId"]) == (True, False, "lote-1")
    assert hijo["source"] == {"key": "ventas-core-process"} and hijo["sourceVersion"] == {"version": "v1"}


def test_insumo_sin_registrar_no_se_inventa_fuente():
    corrida = registro("demand-forecast-service", "corrida", "c1", insumos=[LOTE])
    hijo = arbol([corrida], corrida)["root"]["inputs"][0]
    assert hijo == {"reference": {"service": LOTE[0], "resourceType": LOTE[1], "resourceId": LOTE[2]},
                    "registered": False, "restricted": False, "inputs": []}


def test_insumo_ajeno_sale_restringido_solo_con_su_referencia():
    corrida = registro("demand-forecast-service", "corrida", "c1", usuario="u-1", insumos=[LOTE])
    hijo = arbol([corrida, registro(*LOTE, usuario="u-2")], corrida, usuario="u-1")["root"]["inputs"][0]
    assert (hijo["registered"], hijo["restricted"]) == (True, True)
    assert "record" not in hijo and "source" not in hijo


def cadena(n):
    regs = []
    for i in range(n):
        siguiente = [("demand-forecast-service", "corrida", f"c{i + 1}")] if i + 1 < n else []
        regs.append(registro("demand-forecast-service", "corrida", f"c{i}", insumos=siguiente))
    return regs


@pytest.mark.parametrize("niveles, profundidad, truncado", [(5, 5, False), (6, 5, True), (9, 5, True)])
def test_hasta_5_niveles(niveles, profundidad, truncado):
    regs = cadena(niveles)
    r = arbol(regs, regs[0])
    assert (r["depth"], r["truncated"]) == (profundidad, truncado)


def test_un_ciclo_se_corta():
    a = registro("demand-forecast-service", "corrida", "a", insumos=[("demand-forecast-service", "corrida", "b")])
    b = registro("demand-forecast-service", "corrida", "b", insumos=[("demand-forecast-service", "corrida", "a")])
    r = arbol([a, b], a)
    assert (r["depth"], r["truncated"]) == (2, False)
    assert r["root"]["inputs"][0]["inputs"] == []
