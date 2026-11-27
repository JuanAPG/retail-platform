"""El script de medición (scripts/medir_pronostico.py) arma la misma serie que el servicio.

Con un dataset mínimo del formato del generador: unidad base por producto (DF-2), semana local que
empieza en lunes, semanas sin venta en 0 (DF-3), 422 con 11 semanas (D-40) y con unidades mezcladas.
"""
import importlib.util
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

_RUTA = Path(__file__).resolve().parents[1] / "scripts" / "medir_pronostico.py"
_spec = importlib.util.spec_from_file_location("medir_pronostico", _RUTA)
medir = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(medir)

HASTA = date(2026, 11, 22)   # domingo: cierra la ventana


def escribir_datos(carpeta: Path, semanas_arroz: int, semanas_bebida: int):
    catalogo = {
        "tiendas": [{"nombre": f"T{i}", "zona": "Zona Centro"} for i in range(3)],
        "productos": [
            {"sku": "ARROZ", "presentaciones": [{"nombre": "1 kg", "contenido": 1, "unidadMedida": "kg"},
                                                {"nombre": "500 g", "contenido": 500, "unidadMedida": "g"}]},
            {"sku": "BEBIDA", "presentaciones": [{"nombre": "473 ml", "contenido": 473, "unidadMedida": "ml"}]},
            {"sku": "HUEVO", "presentaciones": [{"nombre": "12 pza", "contenido": 12, "unidadMedida": "pza"},
                                                {"nombre": "1 kg", "contenido": 1, "unidadMedida": "kg"}]},
        ],
    }
    lineas = ["folio,fecha,tienda,sku,presentacion,cantidad,precio"]
    folio = 0
    fin = HASTA - timedelta(days=6)   # lunes de la última semana

    def venta(dia: date, sku, pres, cantidad, tienda):
        nonlocal folio
        folio += 1
        # 22:30 en Monterrey es el día siguiente en UTC: la semana debe salir de la fecha local.
        lineas.append(f"F{folio},{dia.isoformat()} 22:30:00-06,T{tienda},{sku},{pres},{cantidad},10.00")

    for k in range(semanas_arroz):
        lunes = fin - timedelta(weeks=semanas_arroz - 1 - k)
        venta(lunes + timedelta(days=6), "ARROZ", "1 kg", 2, k % 3)     # domingo: sigue en su semana
        venta(lunes, "ARROZ", "500 g", 2, (k + 1) % 3)                  # 2 × 0.5 kg = 1 kg
    for k in range(semanas_bebida):
        venta(fin - timedelta(weeks=semanas_bebida - 1 - k), "BEBIDA", "473 ml", 1, k % 3)
    venta(fin, "HUEVO", "12 pza", 1, 0)
    venta(fin, "HUEVO", "1 kg", 1, 1)
    (carpeta / "catalogo.json").write_text(json.dumps(catalogo), encoding="utf-8")
    (carpeta / "ventas-0001.csv").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    return catalogo


@pytest.fixture
def datos(tmp_path):
    catalogo = escribir_datos(tmp_path, semanas_arroz=13, semanas_bebida=11)
    zona_de = {t["nombre"]: t["zona"] for t in catalogo["tiendas"]}
    cantidades, folios, tiendas = medir.leer_ventas(tmp_path, zona_de)
    return catalogo, cantidades, folios, tiendas


def serie(datos, sku, zona="Zona Centro"):
    catalogo, cantidades, folios, tiendas = datos
    pres = medir.presentaciones_del_catalogo(catalogo)[sku]
    return medir.medir_serie((sku, zona), cantidades[(sku, zona)], pres, len(folios[(sku, zona)]),
                             len(tiendas[(sku, zona)]), HASTA, 4)


def test_unidad_base_y_semana_local(datos):
    """1 kg × 2 + 500 g × 2 = 3 kg por semana, aunque la venta del domingo 22:30 sea lunes en UTC."""
    _, cantidades, _, _ = datos
    semanas = cantidades[("ARROZ", "Zona Centro")]
    assert len(semanas) == 13
    assert all(set(p) == {"ARROZ|1 kg", "ARROZ|500 g"} for p in semanas.values())
    fila = serie(datos, "ARROZ")
    assert (fila["estado"], fila["semanas"], fila["unidad"], fila["rellenadas"]) == (201, 13, "kg", 0)
    assert fila["mape"] == pytest.approx(0, abs=1e-6)   # 3 kg constantes: el modelo no se equivoca


def test_once_semanas_es_422(datos):
    fila = serie(datos, "BEBIDA")
    assert fila["estado"] == 422 and "11 semanas" in fila["motivo"]


def test_unidades_mezcladas_es_422(datos):
    fila = serie(datos, "HUEVO")
    assert fila["estado"] == 422 and "tipos de unidad distintos" in fila["motivo"]


def test_tambien_por_producto_en_todas_las_zonas(datos):
    _, cantidades, folios, _ = datos
    assert ("ARROZ", None) in cantidades
    assert len(folios[("ARROZ", None)]) == len(folios[("ARROZ", "Zona Centro")]) == 26


def test_factores_de_unidad():
    catalogo = {"productos": [{"sku": "X", "presentaciones": [{"nombre": "250 ml", "contenido": 250, "unidadMedida": "ml"}]}]}
    p = medir.presentaciones_del_catalogo(catalogo)["X"][0]
    assert p == {"id": "X|250 ml", "contenido": 250, "unidadMedida": {"tipo": "volumen", "factorBase": 0.001}}
