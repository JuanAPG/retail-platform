"""Semanas (DF-1, DF-3), unidades (DF-2) y publicación (DF-8): casos de control del contrato."""
from datetime import date, datetime, timezone

import pytest

from app.dominio import ErrorDominio
from app.publicacion import evaluar
from app.semanas import huella, serie_semanal, ultimo_domingo_completo, ventana
from app.unidades import convertir

UTC = timezone.utc


# --- DF-1: semanas completas en America/Monterrey (UTC−6)

@pytest.mark.parametrize("ahora_utc, domingo", [
    # Jueves 26-nov-2026: la última semana completa terminó el domingo 22.
    (datetime(2026, 11, 26, 18, 0, tzinfo=UTC), date(2026, 11, 22)),
    # Lunes 23-nov 00:30 en Monterrey (06:30 UTC): la semana del 16 al 22 ya cerró.
    (datetime(2026, 11, 23, 6, 30, tzinfo=UTC), date(2026, 11, 22)),
    # Domingo 22-nov 23:00 en Monterrey (lunes 05:00 UTC): esa semana sigue en curso.
    (datetime(2026, 11, 23, 5, 0, tzinfo=UTC), date(2026, 11, 15)),
])
def test_ultima_semana_completa_en_hora_de_monterrey(ahora_utc, domingo):
    assert ultimo_domingo_completo(ahora_utc) == domingo


def test_ventana_se_ajusta_a_semanas_completas():
    ahora = datetime(2026, 11, 26, 18, 0, tzinfo=UTC)
    # Miércoles → lunes siguiente; miércoles → domingo anterior.
    assert ventana(date(2026, 7, 1), date(2026, 11, 18), ahora) == (date(2026, 7, 6), date(2026, 11, 15))
    # Lunes y domingo se quedan.
    assert ventana(date(2026, 7, 6), date(2026, 11, 15), ahora) == (date(2026, 7, 6), date(2026, 11, 15))
    # Una fecha en la semana en curso (o futura) se recorta a la última semana completa.
    assert ventana(None, date(2026, 12, 31), ahora) == (None, date(2026, 11, 22))
    assert ventana(None, None, ahora) == (None, date(2026, 11, 22))


# --- DF-3: semanas sin venta en medio cuentan como 0

def test_semana_sin_ventas_en_medio_se_rellena():
    por_semana = {date(2026, 11, 2): 5.0, date(2026, 11, 16): 7.0}
    serie = serie_semanal(por_semana, date(2026, 11, 22))

    assert [s["weekStart"] for s in serie] == ["2026-11-02", "2026-11-09", "2026-11-16"]
    assert [s["quantity"] for s in serie] == [5.0, 0.0, 7.0]
    assert [s["filled"] for s in serie] == [False, True, False]


def test_la_serie_empieza_en_la_primera_venta_y_llega_al_fin_de_la_ventana():
    serie = serie_semanal({date(2026, 11, 2): 5.0}, date(2026, 11, 22))
    assert [s["weekStart"] for s in serie] == ["2026-11-02", "2026-11-09", "2026-11-16"]
    assert serie_semanal({}, date(2026, 11, 22)) == []


def test_huella_depende_solo_de_la_serie():
    a = [{"weekStart": "2026-11-02", "quantity": 5.0, "filled": False}]
    assert huella(a) == huella([dict(a[0])])
    assert huella(a) != huella([{**a[0], "quantity": 5.5}])


# --- DF-2: unidad base y tipos mezclados

def presentacion(pid, contenido, clave, tipo, factor):
    return {"id": pid, "contenido": contenido, "unidadMedida": {"clave": clave, "tipo": tipo, "factorBase": factor}}


ML_500 = presentacion("ml500", "500.000", "ml", "volumen", "0.001000")
L_1 = presentacion("l1", "1.000", "l", "volumen", "1.000000")
PZA_12 = presentacion("pza12", "12.000", "pza", "pieza", "1.000000")
KG_1 = presentacion("kg1", "1.000", "kg", "masa", "1.000000")


def test_conversion_500_ml_y_1_l_suman_2_5_l():
    filas = [{"weekStart": "2026-11-16", "presentationId": "ml500", "quantity": 3},
             {"weekStart": "2026-11-16", "presentationId": "l1", "quantity": 1}]
    r = convertir(filas, [ML_500, L_1])

    assert r["porSemana"] == {date(2026, 11, 16): 2.5}
    assert (r["unit"], r["unitType"]) == ("l", "volumen")
    assert r["excluded"] == []


def test_presentaciones_de_tipos_distintos_dan_422():
    filas = [{"weekStart": "2026-11-16", "presentationId": "pza12", "quantity": 2},
             {"weekStart": "2026-11-16", "presentationId": "kg1", "quantity": 1}]
    with pytest.raises(ErrorDominio) as error:
        convertir(filas, [PZA_12, KG_1])
    assert error.value.status == 422
    assert "masa, pieza" in error.value.mensaje


def test_tipos_distintos_en_catalogo_pero_vendido_uno_solo_si_se_calcula():
    filas = [{"weekStart": "2026-11-16", "presentationId": "pza12", "quantity": 2}]
    r = convertir(filas, [PZA_12, KG_1])
    assert r["porSemana"] == {date(2026, 11, 16): 24.0}
    assert r["unit"] == "pza"


def test_presentacion_que_el_catalogo_no_devuelve_se_excluye_con_motivo():
    filas = [{"weekStart": "2026-11-16", "presentationId": "l1", "quantity": 2},
             {"weekStart": "2026-11-16", "presentationId": "baja", "quantity": 9}]
    r = convertir(filas, [L_1])

    assert r["porSemana"] == {date(2026, 11, 16): 2.0}  # las 9 de la baja no se suman
    assert r["excluded"] == [{"presentationId": "baja",
                              "reason": "Presentación inactiva sin contenido conocido: sus ventas no se convierten a l."}]


def test_cantidades_decimales_sin_ruido_binario():
    filas = [{"weekStart": "2026-11-16", "presentationId": "kg1", "quantity": 0.1},
             {"weekStart": "2026-11-16", "presentationId": "kg1", "quantity": 0.2}]
    assert convertir(filas, [KG_1])["porSemana"][date(2026, 11, 16)] == 0.3


# --- DF-8: D-36 y P-11

@pytest.mark.parametrize("transacciones, tiendas, ambos, cualquiera", [
    (9, 3, False, True),
    (10, 2, False, True),
    (10, 3, True, True),
    (9, 2, False, False),
])
def test_d36_fronteras_con_las_dos_reglas(transacciones, tiendas, ambos, cualquiera):
    assert evaluar(transacciones, tiendas, "ambos", con_zona=True)[0] is ambos
    assert evaluar(transacciones, tiendas, "cualquiera", con_zona=True)[0] is cualquiera


def test_d36_motivo_dice_que_falto_y_donde():
    assert evaluar(9, 2, "ambos", con_zona=True) == (
        False, "Menos de 10 transacciones y menos de 3 tiendas con el producto en la zona (D-36).")
    assert evaluar(10, 2, "ambos", con_zona=False) == (
        False, "Menos de 3 tiendas con el producto en todas las zonas (D-36).")
    assert evaluar(10, 3, "ambos", con_zona=True) == (True, None)


def test_regla_desconocida_no_se_acepta(monkeypatch):
    from app.dominio import regla_publicacion
    with pytest.raises(ValueError):
        evaluar(10, 3, "alguna", con_zona=True)
    monkeypatch.setenv("PUBLICATION_RULE", "alguna")
    with pytest.raises(ValueError):
        regla_publicacion()
