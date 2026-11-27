"""Árbol de origen: "¿de dónde salió este resultado?" (DG-5, DG-6; caso de control de D-43).

Recorre `inputs` hacia atrás hasta 5 niveles (`truncated: true` si hay más). Un ciclo se corta. Un
insumo sin linaje registrado sale con `registered: false`, sin inventarle fuente. Para quien solo ve
lo propio, un insumo ajeno sale con `restricted: true` y solo su `reference`.

El recorrido no sabe de base de datos: recibe funciones para buscar registros y describir fuentes.
"""
from __future__ import annotations

from collections.abc import Callable

from .dominio import MAX_NIVELES_ORIGEN

Referencia = tuple[str, str, str]  # (service, resourceType, resourceId)


def referencia(ref: Referencia) -> dict:
    return {"service": ref[0], "resourceType": ref[1], "resourceId": ref[2]}


def construir(raiz: dict, buscar: Callable[[Referencia], dict | None], puede_ver: Callable[[dict], bool],
              fuente: Callable[[str], dict], version: Callable[[str, str], dict]) -> dict:
    """`raiz`: el registro pedido (ya verificado como visible). Devuelve `{depth, truncated, root}`.

    `buscar(ref)`: registro de linaje del recurso o None. `puede_ver(registro)`: DG-6.
    `fuente(key)` y `version(key, version)`: descripción de la fuente y de su versión.
    """
    estado = {"profundidad": 0, "truncado": False}

    def nodo(registro: dict, nivel: int, camino: frozenset) -> dict:
        estado["profundidad"] = max(estado["profundidad"], nivel)
        clave = (registro["service"], registro["resourceType"], registro["resourceId"])
        salida = {"reference": referencia(clave), "registered": True, "restricted": False, "record": registro,
                  "source": fuente(registro["source"]["key"]),
                  "sourceVersion": version(registro["source"]["key"], registro["source"]["version"]),
                  "inputs": []}
        for insumo in registro["inputs"]:
            ref = (insumo["service"], insumo["resourceType"], insumo["resourceId"])
            if ref in camino:
                continue  # ciclo: se corta (DG-5)
            if nivel >= MAX_NIVELES_ORIGEN:
                estado["truncado"] = True
                break
            encontrado = buscar(ref)
            if encontrado is None:
                estado["profundidad"] = max(estado["profundidad"], nivel + 1)
                salida["inputs"].append({"reference": referencia(ref), "registered": False, "restricted": False,
                                         "inputs": []})
            elif not puede_ver(encontrado):
                estado["profundidad"] = max(estado["profundidad"], nivel + 1)
                salida["inputs"].append({"reference": referencia(ref), "registered": True, "restricted": True,
                                         "inputs": []})
            else:
                salida["inputs"].append(nodo(encontrado, nivel + 1, camino | {ref}))
        return salida

    clave_raiz = (raiz["service"], raiz["resourceType"], raiz["resourceId"])
    arbol = nodo(raiz, 1, frozenset({clave_raiz}))
    return {"depth": estado["profundidad"], "truncated": estado["truncado"], "root": arbol}
