"""Holt-Winters (DF-4 a DF-7): casos de control de la tabla del contrato."""
import json
from datetime import date, timedelta

import numpy as np
import pytest

from app.dominio import ErrorDominio
from app.modelo import pronosticar

INICIO = date(2025, 11, 24)  # lunes


def serie(valores, rellenadas=()):
    return [{"weekStart": (INICIO + timedelta(weeks=t)).isoformat(), "quantity": float(v), "filled": t in rellenadas}
            for t, v in enumerate(valores)]


def patron(t):
    return 100 + 2 * t + [10, 0, -6, -4][t % 4]


# --- DF-4 y DF-5: mínimos de historia

def test_11_semanas_dan_422_con_el_texto_del_contrato():
    with pytest.raises(ErrorDominio) as error:
        pronosticar(serie([patron(t) for t in range(11)]), periodo=4)
    assert error.value.status == 422
    assert error.value.mensaje == "Hay 11 semanas de historia; el pronóstico necesita al menos 12 (D-40)."


def test_12_semanas_si_alcanzan():
    r = pronosticar(serie([patron(t) for t in range(12)]), periodo=4)
    assert r["validation"]["trainWeeks"] == 8
    assert len(r["forecast"]) == 8
    assert any("Pocas semanas" in l for l in r["limitations"])


def test_periodo_que_no_cabe_dos_veces_da_422():
    # 12 semanas → 8 para ajustar; un periodo de 5 necesitaría 10.
    with pytest.raises(ErrorDominio) as error:
        pronosticar(serie([patron(t) for t in range(12)]), periodo=5)
    assert "necesita al menos 10 (dos ciclos completos, DF-5)" in error.value.mensaje


# --- Patrón conocido y con ruido

@pytest.mark.parametrize("semanas", [12, 16, 26, 52])
def test_patron_conocido_se_recupera(semanas):
    r = pronosticar(serie([patron(t) for t in range(semanas)]), periodo=4)

    assert r["validation"]["mape"] < 0.5
    for i, fila in enumerate(r["forecast"]):
        assert abs(fila["quantity"] - patron(semanas + i)) < 0.5, (semanas, i)
        assert fila["lower95"] <= fila["lower80"] <= fila["quantity"] <= fila["upper80"] <= fila["upper95"]
    assert [f["weekStart"] for f in r["forecast"]][0] == (INICIO + timedelta(weeks=semanas)).isoformat()


@pytest.mark.parametrize("semanas", [12, 52])
def test_patron_con_ruido(semanas):
    ruido = np.random.default_rng(1).normal(0, 3, semanas)
    r = pronosticar(serie([patron(t) + ruido[t] for t in range(semanas)]), periodo=4)
    assert r["validation"]["mape"] < 3


def test_el_intervalo_de_95_es_mas_ancho_que_el_de_80():
    ruido = np.random.default_rng(1).normal(0, 3, 26)
    r = pronosticar(serie([patron(t) + ruido[t] for t in range(26)]), periodo=4)
    for fila in r["forecast"]:
        assert fila["upper95"] - fila["lower95"] > fila["upper80"] - fila["lower80"] > 0


# --- DF-6: validación con las 4 reservadas

def test_la_validacion_no_ve_las_reservadas():
    # Mismas 8 semanas de ajuste y reservadas distintas: el pronóstico de validación no cambia.
    base = [patron(t) for t in range(12)]
    otra = base[:8] + [999, 999, 999, 999]
    a, b = pronosticar(serie(base), 4)["validation"], pronosticar(serie(otra), 4)["validation"]
    assert [h["forecast"] for h in a["holdout"]] == [h["forecast"] for h in b["holdout"]]
    assert [h["actual"] for h in b["holdout"]] == [999.0] * 4


def test_reservadas_en_cero_dan_mape_nulo_con_motivo():
    valores = [patron(t) for t in range(12)][:8] + [0, 0, 0, 0]
    v = pronosticar(serie(valores, rellenadas={8, 9, 10, 11}), periodo=4)["validation"]

    assert v["mape"] is None
    assert v["zeroWeeksExcluded"] == 4 and v["mapeWeeks"] == 0
    assert "no se puede calcular" in v["motivo"]


def test_una_reservada_en_cero_se_excluye_del_mape():
    valores = [patron(t) for t in range(16)]
    valores[13] = 0
    v = pronosticar(serie(valores, rellenadas={13}), periodo=4)["validation"]
    assert (v["mapeWeeks"], v["zeroWeeksExcluded"]) == (3, 1)
    assert v["mape"] is not None


# --- DF-3 y DF-7: avisos de semanas rellenadas y recorte a 0

def test_semana_rellenada_se_avisa():
    valores = [patron(t) for t in range(20)]
    valores[9] = 0
    r = pronosticar(serie(valores, rellenadas={9}), periodo=4)
    assert "Una semana sin ventas cuenta como 0 (1 semana rellenada)." in r["limitations"]


def test_muchas_semanas_en_cero_recortan_el_limite_inferior():
    valores = [0, 0, 3, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 2, 0, 0]
    r = pronosticar(serie(valores, rellenadas={t for t, v in enumerate(valores) if v == 0}), periodo=4)

    assert any(f["clipped"] for f in r["forecast"])
    for f in r["forecast"]:
        assert min(f["quantity"], f["lower80"], f["lower95"]) >= 0
        if f["clipped"]:
            assert f["lower95"] == 0.0
    assert any("se recortó a 0" in l for l in r["limitations"])


# --- D-15: determinista y serializable

def test_misma_serie_mismo_resultado():
    ruido = np.random.default_rng(1).normal(0, 3, 30)
    s = serie([patron(t) + ruido[t] for t in range(30)])
    assert pronosticar(s, 4) == pronosticar(json.loads(json.dumps(s)), 4)


def test_nada_es_infinito_ni_nan():
    # Un ajuste perfecto puede dar AIC infinito: sale nulo, nunca Infinity en el JSON.
    r = pronosticar(serie([patron(t) for t in range(52)]), periodo=4)
    json.dumps(r, allow_nan=False)
    assert r["model"]["library"].startswith("statsmodels ")
