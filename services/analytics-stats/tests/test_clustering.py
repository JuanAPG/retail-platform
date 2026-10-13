"""STA-03: el clustering de zonas contra scikit-learn, su numeración estable,
la reproducibilidad desde la entrada guardada (D-15) y los límites de D-27."""
import math
import random

import numpy as np
import pytest
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from app.clustering import agrupar_zonas
from app.estadistica import DatosInvalidos

TODAS = ["estimatedIncome", "population", "availability", "averageTicket"]

#: Las 3 zonas sembradas, con su ticket del CSV de 100 canastas.
SEMBRADAS = [
    {"zoneId": "6cd8d7f5", "zoneName": "Zona Valle", "estimatedIncome": 65000, "population": 85000,
     "availability": 0.95, "averageTicket": 143.20238095238096},
    {"zoneId": "ed073f6d", "zoneName": "Zona Centro", "estimatedIncome": 28000, "population": 120000,
     "availability": 0.85, "averageTicket": 96.3970588235294},
    {"zoneId": "f48d6f15", "zoneName": "Zona Oriente", "estimatedIncome": 12000, "population": 150000,
     "availability": 0.65, "averageTicket": 73.63333333333334},
]

_azar = np.random.default_rng(16)
#: Ocho zonas sintéticas en dos niveles de ingreso, con ruido.
OCHO = [
    {"zoneId": f"z{i}", "zoneName": f"Zona {i}",
     "estimatedIncome": float((15000 if i < 4 else 55000) + _azar.normal(0, 4000)),
     "population": float(_azar.normal(110000, 20000)),
     "availability": float(min(1, max(0, _azar.normal(0.8, 0.1)))),
     "averageTicket": float((80 if i < 4 else 140) + _azar.normal(0, 10))}
    for i in range(8)
]


def cerca(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)


def particion(asignaciones: list[dict]) -> set[frozenset]:
    grupos: dict[int, set] = {}
    for a in asignaciones:
        grupos.setdefault(a["cluster"], set()).add(a["zoneId"])
    return {frozenset(g) for g in grupos.values()}


@pytest.mark.parametrize("k", [2, 3, 4])
@pytest.mark.parametrize("features", [TODAS, ["estimatedIncome", "averageTicket"], ["population"]])
def test_igual_a_scikit_learn(k, features):
    r = agrupar_zonas(OCHO, k, 42, features)

    ordenadas = sorted(OCHO, key=lambda z: z["zoneId"])
    estandarizados = StandardScaler().fit_transform([[z[v] for v in features] for z in ordenadas])
    modelo = KMeans(n_clusters=k, random_state=42, n_init=10).fit(estandarizados)
    esperada = {frozenset(z["zoneId"] for z, e in zip(ordenadas, modelo.labels_) if e == g) for g in set(modelo.labels_)}

    assert particion(r["assignments"]) == esperada
    assert cerca(r["inertia"], modelo.inertia_)
    assert cerca(r["silhouette"], silhouette_score(estandarizados, modelo.labels_))


def test_las_zonas_sembradas_separan_a_valle():
    r = agrupar_zonas(SEMBRADAS, 2, 42, TODAS)

    assert particion(r["assignments"]) == {frozenset({"6cd8d7f5"}), frozenset({"ed073f6d", "f48d6f15"})}
    # Cluster 1 = el de menor ingreso promedio; su centroide en unidades originales.
    assert r["clusters"][0] == {"cluster": 1, "size": 2, "centroid": {
        "estimatedIncome": 20000.0, "population": 135000.0, "availability": 0.75,
        "averageTicket": (96.3970588235294 + 73.63333333333334) / 2}}


def test_el_orden_de_entrada_no_cambia_nada():
    esperado = agrupar_zonas(OCHO, 3, 7, TODAS)
    for semilla in range(5):
        revueltas = OCHO[:]
        random.Random(semilla).shuffle(revueltas)
        assert agrupar_zonas(revueltas, 3, 7, TODAS) == esperado


def test_se_numeran_por_el_promedio_de_la_primera_variable():
    for features in (["estimatedIncome", "population"], ["population", "estimatedIncome"]):
        r = agrupar_zonas(OCHO, 3, 42, features)
        promedios = [c["centroid"][features[0]] for c in r["clusters"]]
        assert [c["cluster"] for c in r["clusters"]] == [1, 2, 3]
        assert promedios == sorted(promedios)


def test_el_centroide_es_el_promedio_de_sus_zonas():
    r = agrupar_zonas(OCHO, 2, 42, TODAS)
    for grupo in r["clusters"]:
        zonas = [a["zoneId"] for a in r["assignments"] if a["cluster"] == grupo["cluster"]]
        datos = [z for z in OCHO if z["zoneId"] in zonas]
        assert grupo["size"] == len(zonas)
        for v in TODAS:
            assert cerca(grupo["centroid"][v], np.mean([z[v] for z in datos]))


def test_reproducible_desde_la_entrada_guardada_d15():
    # Lo que se guarda en Mongo es la entrada y la semilla: repetirla da lo mismo.
    primera = agrupar_zonas(OCHO, 3, 123, TODAS)
    guardada = [dict(z) for z in OCHO]

    assert agrupar_zonas(guardada, 3, 123, TODAS) == primera


def test_zona_sin_dato_se_excluye_y_no_se_rellena_con_cero():
    zonas = OCHO + [{"zoneId": "z9", "zoneName": "Zona Nueva", "estimatedIncome": 30000, "population": None,
                     "availability": 0.7, "averageTicket": None}]

    r = agrupar_zonas(zonas, 2, 42, TODAS)

    assert r["excludedZones"] == [{"zoneId": "z9", "zoneName": "Zona Nueva",
                                   "reason": "Sin población, ticket promedio: no se rellena con 0 (D-20)."}]
    assert "z9" not in {a["zoneId"] for a in r["assignments"]}
    assert r == {**agrupar_zonas(OCHO, 2, 42, TODAS), "excludedZones": r["excludedZones"],
                 "assumptions": r["assumptions"]}
    assert any("quedaron fuera" in s for s in r["assumptions"])


def test_una_variable_que_no_se_pide_no_excluye():
    zonas = OCHO + [{"zoneId": "z9", "estimatedIncome": 30000, "population": None,
                     "availability": None, "averageTicket": 100.0}]

    r = agrupar_zonas(zonas, 2, 42, ["estimatedIncome", "averageTicket"])

    assert r["excludedZones"] == []


@pytest.mark.parametrize("zonas,k,mensaje", [
    (SEMBRADAS, 3, "k debe ser menor que el número de zonas con datos (3): con estos datos solo se puede k = 2 (D-27)."),
    (OCHO[:5], 5, "k debe ser menor que el número de zonas con datos (5): con estos datos k puede ir de 2 a 4 (D-27)."),
    (SEMBRADAS[:2], 2, "Se necesitan al menos 3 zonas con datos para agrupar; hay 2."),
])
def test_limites_de_k_d27(zonas, k, mensaje):
    with pytest.raises(DatosInvalidos) as error:
        agrupar_zonas(zonas, k, 42, TODAS)
    assert str(error.value) == mensaje


def test_menos_zonas_distintas_que_grupos_es_400():
    iguales = [{"zoneId": f"z{i}", "estimatedIncome": 1000.0 * (i % 2)} for i in range(5)]

    with pytest.raises(DatosInvalidos, match="Solo hay 2 zonas con valores distintos"):
        agrupar_zonas(iguales, 3, 42, ["estimatedIncome"])


def test_una_variable_igual_en_todas_se_avisa():
    zonas = [dict(z, availability=0.9) for z in OCHO]

    r = agrupar_zonas(zonas, 2, 42, TODAS)

    assert any("no influye en los grupos: disponibilidad" in s for s in r["assumptions"])


def _solo_tipos_nativos(valor) -> bool:
    if isinstance(valor, dict):
        return all(_solo_tipos_nativos(v) for v in valor.values())
    if isinstance(valor, list):
        return all(_solo_tipos_nativos(v) for v in valor)
    return type(valor) in (str, int, float, bool, type(None))


def test_todo_sale_en_tipos_nativos_de_python():
    assert _solo_tipos_nativos(agrupar_zonas(OCHO, 3, 42, TODAS))
