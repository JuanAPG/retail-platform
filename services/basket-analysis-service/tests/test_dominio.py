"""Casos de control del contrato: D-37 (BA-2/3/4/7), D-36 (BA-5), comparación, evolución y D-35."""
import random
from datetime import date

import pytest

from app.comparacion import comparar
from app.dominio import ErrorDominio, regla_publicacion
from app.periodos import periodos, semanas, versiones_en_periodo
from app.publicacion import evaluar
from app.tipica import es_tipico, huella, productos, resumen, tamano_tipico

CATEGORIAS = {1: "Abarrotes", 2: "Lácteos"}


def fila(n, k, spend, categoria=1, periodo=None):
    return {"periodStart": periodo, "productId": f"p-{n:02d}", "productName": f"Producto {n}", "categoryId": categoria,
            "basketsWithProduct": k, "spend": spend}


def periodo(canastas, tiendas=4, gasto=1000.0, inicio=None):
    return {"periodStart": inicio, "baskets": canastas, "stores": tiendas, "totalSpend": gasto}


# --- BA-3: umbral del 20 % con enteros

@pytest.mark.parametrize("k, n, tipico", [(20, 100, True), (19, 100, False), (3, 12, True), (2, 12, False),
                                          (60, 300, True), (59, 300, False), (1, 5, True), (0, 5, False)])
def test_frontera_del_20_por_ciento_con_enteros(k, n, tipico):
    assert es_tipico(k, n) is tipico


def test_include_all_muestra_la_frontera():
    filas = [fila(1, 20, 1110.0), fila(2, 19, 1748.0)]
    solo_tipicos = productos(periodo(100), filas, CATEGORIAS, incluir_todo=False)
    todos = productos(periodo(100), filas, CATEGORIAS, incluir_todo=True)

    assert [p["productId"] for p in solo_tipicos] == ["p-01"]
    assert [(p["productId"], p["typical"], p["frequency"]) for p in todos] == [("p-01", True, 0.2), ("p-02", False, 0.19)]


# --- BA-4: frecuencia, gasto promedio y resumen

def test_frecuencia_y_gasto_promedio():
    [p] = productos(periodo(100), [fila(1, 62, 3534.0, categoria=2)], CATEGORIAS, incluir_todo=False)
    assert p == {"productId": "p-01", "productName": "Producto 1", "categoryId": 2, "categoryName": "Lácteos",
                 "basketsWithProduct": 62, "frequency": 0.62, "averageSpend": 57.0, "typical": True}


def test_producto_sin_categoria():
    [p] = productos(periodo(10), [fila(1, 5, 50.0, categoria=None)], CATEGORIAS, incluir_todo=False)
    assert (p["categoryId"], p["categoryName"]) == (None, "Sin categoría")


def test_resumen_del_grupo():
    filas = [fila(1, 62, 3534.0), fila(2, 55, 1265.0), fila(3, 41, 1742.5), fila(4, 33, 1584.0), fila(5, 20, 1110.0),
             fila(6, 19, 1748.0)]
    r = resumen(periodo(100, gasto=10983.5), filas, semanas(date(2026, 10, 1), date(2026, 10, 31)))

    assert r == {"baskets": 100, "totalSpend": 10983.5, "averageTicket": 109.83, "productsPerBasket": 2.3,
                 "basketsPerWeek": 100 / (31 / 7)}
    assert tamano_tipico(periodo(100), filas) == 5


# --- BA-7: orden estable, sin depender de la llegada

def test_orden_por_frecuencia_y_luego_por_id():
    filas = [fila(3, 40, 1.0), fila(1, 40, 1.0), fila(2, 70, 1.0), fila(4, 25, 1.0)]
    esperado = ["p-02", "p-01", "p-03", "p-04"]
    for semilla in range(5):
        revueltas = filas[:]
        random.Random(semilla).shuffle(revueltas)
        assert [p["productId"] for p in productos(periodo(100), revueltas, CATEGORIAS, False)] == esperado


# --- BA-5: D-36 con las dos reglas y su motivo

@pytest.mark.parametrize("canastas, tiendas, ambos, cualquiera", [
    (9, 3, False, True), (10, 2, False, True), (10, 3, True, True), (9, 2, False, False)])
def test_d36_fronteras(canastas, tiendas, ambos, cualquiera):
    assert evaluar(canastas, tiendas, "ambos")[0] is ambos
    assert evaluar(canastas, tiendas, "cualquiera")[0] is cualquiera


def test_d36_motivos_con_el_texto_del_contrato():
    assert evaluar(40, 1, "ambos") == (
        False, "La combinación zona-segmento tiene 1 tienda (mínimo 3) con 40 canastas (D-36, regla ambos).")
    assert evaluar(9, 3, "ambos") == (
        False, "La combinación zona-segmento tiene 9 transacciones (mínimo 10) en 3 tiendas (D-36, regla ambos).")
    assert evaluar(9, 2, "cualquiera") == (
        False, "La combinación zona-segmento tiene 9 transacciones (mínimo 10) y 2 tiendas (mínimo 3) "
               "(D-36, regla cualquiera).")
    assert evaluar(1, 1, "ambos")[1].startswith("La combinación zona-segmento tiene 1 transacción (mínimo 10) y 1 tienda")


def test_grupo_sin_canastas_no_disponible_con_motivo():
    assert evaluar(0, 0, "ambos") == (False, "No hay canastas de la combinación zona-segmento en el periodo (D-36).")
    assert evaluar(0, 0, "cualquiera")[0] is False


def test_regla_desconocida(monkeypatch):
    with pytest.raises(ValueError):
        evaluar(10, 3, "alguna")
    monkeypatch.setenv("PUBLICATION_RULE", "alguna")
    with pytest.raises(ValueError):
        regla_publicacion()


# --- Comparación entre periodos

def test_comparacion_entran_salen_y_siguen():
    a = productos(periodo(100), [fila(1, 59, 59 * 57.0), fila(6, 22, 22 * 92.0), fila(7, 10, 100.0)], CATEGORIAS, True)
    b = productos(periodo(100), [fila(1, 62, 62 * 57.0), fila(5, 20, 20 * 55.5), fila(6, 19, 19 * 92.0)], CATEGORIAS, True)
    r = comparar(a, b, {"averageTicket": 100.64, "productsPerBasket": 2.13}, {"averageTicket": 109.83, "productsPerBasket": 2.3})

    assert [p["productId"] for p in r["entering"]] == ["p-05"]
    assert [p["productId"] for p in r["leaving"]] == ["p-06"]
    assert [p["productId"] for p in r["staying"]] == ["p-01"]
    entra = r["entering"][0]
    assert (entra["frequencyA"], entra["averageSpendA"], entra["frequencyB"], entra["averageSpendB"]) == (0.0, None, 0.2, 55.5)
    assert r["leaving"][0]["frequencyChange"] == pytest.approx(-0.03)
    # Un producto que no es típico en ningún periodo no aparece.
    assert "p-07" not in {p["productId"] for lista in (r["entering"], r["leaving"], r["staying"]) for p in lista}
    indicadores = {i["indicator"]: i for i in r["indicators"]}
    assert indicadores["typicalSize"] | {} == {"indicator": "typicalSize", "a": 2, "b": 2, "change": 0, "changePercent": 0.0}
    assert indicadores["averageTicket"]["changePercent"] == pytest.approx(9.13155802861685)


def test_cambio_porcentual_nulo_si_a_es_cero():
    r = comparar([], [], {"averageTicket": 0, "productsPerBasket": 0}, {"averageTicket": 5, "productsPerBasket": 1})
    assert all(i["changePercent"] is None for i in r["indicators"][:2])


# --- Evolución: periodos sin huecos, bordes parciales, tope

def test_meses_con_bordes_parciales():
    p = periodos(date(2026, 8, 15), date(2026, 10, 10), "month")
    assert [(x["periodStart"], x["periodEnd"], x["key"]) for x in p] == [
        ("2026-08-15", "2026-08-31", "2026-08-01"),
        ("2026-09-01", "2026-09-30", "2026-09-01"),
        ("2026-10-01", "2026-10-10", "2026-10-01")]


def test_semanas_de_lunes_a_domingo_con_bordes_parciales():
    p = periodos(date(2026, 11, 4), date(2026, 11, 18), "week")  # miércoles a miércoles
    assert [(x["periodStart"], x["periodEnd"], x["key"]) for x in p] == [
        ("2026-11-04", "2026-11-08", "2026-11-02"),
        ("2026-11-09", "2026-11-15", "2026-11-09"),
        ("2026-11-16", "2026-11-18", "2026-11-16")]


def test_diciembre_pasa_a_enero():
    p = periodos(date(2025, 12, 1), date(2026, 1, 31), "month")
    assert [x["key"] for x in p] == ["2025-12-01", "2026-01-01"]


@pytest.mark.parametrize("desde, hasta, granularidad, cabe", [
    (date(2024, 12, 2), date(2026, 11, 29), "week", True),    # 104 semanas
    (date(2024, 11, 25), date(2026, 11, 29), "week", False),  # 105
    (date(2023, 12, 1), date(2026, 11, 30), "month", True),   # 36 meses
    (date(2023, 11, 1), date(2026, 11, 30), "month", False),  # 37
])
def test_tope_de_104_semanas_o_36_meses(desde, hasta, granularidad, cabe):
    if cabe:
        assert len(periodos(desde, hasta, granularidad)) in (104, 36)
    else:
        with pytest.raises(ErrorDominio) as error:
            periodos(desde, hasta, granularidad)
        assert error.value.status == 400


def test_semanas_del_periodo():
    assert semanas(date(2026, 10, 1), date(2026, 10, 31)) == 31 / 7
    assert semanas(date(2026, 11, 2), date(2026, 11, 8)) == 1.0


# --- BA-6 / D-35: versiones del segmento en el periodo

HISTORIAL = [
    {"segmentId": 2, "segmentVersion": 1, "validFrom": "2026-01-01", "validTo": "2026-06-30"},
    {"segmentId": 3, "segmentVersion": 1, "validFrom": "2026-07-01", "validTo": "2026-08-31"},
    {"segmentId": 2, "segmentVersion": 2, "validFrom": "2026-09-01", "validTo": None},
]


def test_versiones_del_segmento_en_el_periodo():
    assert versiones_en_periodo(HISTORIAL, 2, date(2026, 5, 1), date(2026, 10, 31)) == [1, 2]
    assert versiones_en_periodo(HISTORIAL, 2, date(2026, 9, 1), date(2026, 10, 31)) == [2]
    assert versiones_en_periodo(HISTORIAL, 3, date(2026, 9, 1), date(2026, 10, 31)) == []
    assert versiones_en_periodo(HISTORIAL, 2, None, None) == [1, 2]


# --- D-15: huella

def test_huella_no_depende_del_orden_y_si_de_los_datos():
    filas = [fila(1, 20, 100.0), fila(2, 19, 90.0)]
    p = [periodo(100)]
    assert huella(p, filas) == huella(p, list(reversed(filas)))
    assert huella(p, filas) != huella(p, [fila(1, 21, 100.0), fila(2, 19, 90.0)])
    assert len(huella(p, filas)) == 64
