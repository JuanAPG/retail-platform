"""RF-16 — Agrupación de zonas con KMeans, como función pura: sin HTTP ni Mongo.

Agrupa **zonas**, nunca personas (RN-02). Los indicadores se estandarizan
(z-score) para que ninguno pese más por su unidad. Con la misma entrada y la
misma semilla da las mismas asignaciones, sin importar el orden en que lleguen
las zonas (D-15): se ordenan por id y los clusters se numeran por su promedio.
"""
from __future__ import annotations

import warnings

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from .estadistica import DatosInvalidos

VARIABLES = ("estimatedIncome", "population", "availability", "averageTicket")
NOMBRE_VARIABLE = {
    "estimatedIncome": "ingreso estimado",
    "population": "población",
    "availability": "disponibilidad",
    "averageTicket": "ticket promedio",
}


def agrupar_zonas(zonas: list[dict], k: int, seed: int, features: list[str]) -> dict:
    """KMeans sobre las zonas que tienen todas las variables de `features`.

    `zonas`: `[{zoneId, zoneName?, <variable>: número | None, ...}]`. Una zona sin
    alguna variable no se rellena con 0 (D-20): va a `excludedZones` con el motivo.
    """
    ordenadas = sorted(zonas, key=lambda z: z["zoneId"])
    completas, excluidas = [], []
    for zona in ordenadas:
        faltan = [NOMBRE_VARIABLE[v] for v in features if zona.get(v) is None]
        if faltan:
            excluidas.append({"zoneId": zona["zoneId"], "zoneName": zona.get("zoneName"),
                              "reason": f"Sin {', '.join(faltan)}: no se rellena con 0 (D-20)."})
        else:
            completas.append(zona)

    n = len(completas)
    if n < 3:
        raise DatosInvalidos(f"Se necesitan al menos 3 zonas con datos para agrupar; hay {n}.")
    if k >= n:
        rango = "solo se puede k = 2" if n == 3 else f"k puede ir de 2 a {n - 1}"
        raise DatosInvalidos(f"k debe ser menor que el número de zonas con datos ({n}): con estos datos {rango} (D-27).")

    datos = np.array([[float(z[v]) for v in features] for z in completas])
    distintas = len({tuple(fila) for fila in datos})
    if distintas < k:
        raise DatosInvalidos(f"Solo hay {distintas} zonas con valores distintos: no se pueden formar {k} grupos.")

    estandarizados = StandardScaler().fit_transform(datos)
    modelo = KMeans(n_clusters=k, random_state=seed, n_init=10)
    # Un solo hilo: con varios, KMeans suma en distinto orden en cada corrida y la
    # inercia cambia en el último dígito; D-15 pide exactamente el mismo resultado.
    with warnings.catch_warnings(), threadpool_limits(limits=1):
        warnings.simplefilter("ignore")  # Avisos de convergencia de sklearn: el resultado igual es válido.
        etiquetas = modelo.fit_predict(estandarizados)

    # Numeración estable: 1..k por el promedio de la primera variable (y, en
    # empate, por la primera zona del grupo), no por la etiqueta interna de KMeans.
    miembros = {e: [i for i, x in enumerate(etiquetas) if x == e] for e in set(etiquetas)}
    orden = sorted(miembros, key=lambda e: (datos[miembros[e], 0].mean(), min(miembros[e])))
    numero = {e: i + 1 for i, e in enumerate(orden)}

    supuestos = [
        "Se agrupan zonas, nunca personas (RF-16).",
        "Indicadores estandarizados (z-score): ninguno pesa más por su unidad.",
        f"KMeans con semilla {seed}: con los mismos datos, las mismas asignaciones.",
        f"Los grupos se numeran por su {NOMBRE_VARIABLE[features[0]]} promedio, de menor a mayor.",
    ]
    constantes = [NOMBRE_VARIABLE[v] for j, v in enumerate(features) if np.ptp(datos[:, j]) == 0]
    if constantes:
        supuestos.append(f"Igual en todas las zonas, no influye en los grupos: {', '.join(constantes)}.")
    if excluidas:
        supuestos.append(f"{len(excluidas)} zona(s) sin datos completos quedaron fuera (ver excludedZones).")

    return {
        "clusters": [
            {"cluster": numero[e], "size": len(miembros[e]),
             "centroid": {v: float(datos[miembros[e], j].mean()) for j, v in enumerate(features)}}
            for e in orden
        ],
        "assignments": [{"zoneId": z["zoneId"], "zoneName": z.get("zoneName"), "cluster": numero[etiquetas[i]]}
                        for i, z in enumerate(completas)],
        "excludedZones": excluidas,
        "inertia": float(modelo.inertia_),
        # La silueta pide al menos 2 grupos con zonas y menos grupos que zonas.
        "silhouette": float(silhouette_score(estandarizados, etiquetas)) if 2 <= len(miembros) < n else None,
        "assumptions": supuestos,
    }
