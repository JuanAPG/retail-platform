"""Corridas de pronóstico en MongoDB (D-47), colección `forecast_runs`.

Una corrida por documento: parámetros, la serie semanal usada (la foto de D-15) con su SHA-256,
el resultado y `durationMs`. Solo el `userId` de quien la lanzó (D-26). Si Mongo no responde en
2 s → 503 (D-25): una corrida nunca se devuelve sin guardar.
"""
from __future__ import annotations

import os
from datetime import datetime

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from pymongo import DESCENDING, MongoClient
from pymongo.errors import PyMongoError

COLECCION = "forecast_runs"
TIPO = "forecast"
#: Mongo caído debe responder rápido (D-25), no colgar la petición.
TIMEOUT_MS = 2000

#: Lo que trae el listado (`forecastRunSummary`); el resto (serie, pronóstico…) solo el detalle.
_PROYECCION_LISTADO = {"date": 1, "userId": 1, "parameters.productId": 1, "parameters.zoneId": 1,
                       "product.unit": 1, "disponible": 1, "dataVersion.weeks": 1, "validation.mape": 1,
                       "durationMs": 1}


class Corridas:
    def __init__(self, cliente: MongoClient):
        self._coleccion = cliente.get_default_database()[COLECCION]
        self._con_indices = False

    def guardar(self, corrida: dict) -> dict:
        """Guarda y devuelve la corrida como la leerá después `GET /v1/forecast/runs/:id`.

        La fecha se trunca a milisegundos, como la guarda BSON: así el `201` es idéntico a lo que
        se relee.
        """
        documento = {**corrida, "type": TIPO}
        fecha = documento.get("date")
        if isinstance(fecha, datetime):
            documento["date"] = fecha.replace(microsecond=fecha.microsecond // 1000 * 1000)
        with _sin_mongo("guardar la corrida"):
            self._indices()
            documento["_id"] = self._coleccion.insert_one(documento).inserted_id
        return _respuesta(documento)

    def listar(self, producto_id: str | None, zona_id: str | None, pagina: int, limite: int) -> tuple[list[dict], int]:
        filtro: dict = {"type": TIPO}
        if producto_id:
            filtro["parameters.productId"] = producto_id
        if zona_id:
            filtro["parameters.zoneId"] = zona_id
        with _sin_mongo("leer las corridas"):
            total = self._coleccion.count_documents(filtro)
            cursor = (self._coleccion.find(filtro, _PROYECCION_LISTADO)
                      .sort([("date", DESCENDING), ("_id", DESCENDING)])
                      .skip((pagina - 1) * limite).limit(limite))
            return [_resumen(d) for d in cursor], total

    def obtener(self, id_corrida: str) -> dict:
        try:
            clave = ObjectId(id_corrida)
        except (InvalidId, TypeError):
            raise HTTPException(400, f"'{id_corrida}' no es un id de corrida (ObjectId de 24 caracteres hex).") from None
        with _sin_mongo("leer la corrida"):
            documento = self._coleccion.find_one({"_id": clave, "type": TIPO})
        if documento is None:
            raise HTTPException(404, f"No existe la corrida de pronóstico {id_corrida}.")
        return _respuesta(documento)

    def _indices(self) -> None:
        # Contrato: las corridas de un usuario y las de un producto, de la más reciente a la más antigua.
        if not self._con_indices:
            self._coleccion.create_index([("userId", 1), ("date", DESCENDING)], name="userId_date")
            self._coleccion.create_index([("parameters.productId", 1), ("date", DESCENDING)],
                                         name="productId_date")
            self._con_indices = True


class _sin_mongo:
    """Convierte cualquier falla de Mongo en 503 con un mensaje claro (D-25)."""

    def __init__(self, que: str):
        self._que = que

    def __enter__(self):
        return self

    def __exit__(self, tipo, error, _traza):
        if error is not None and isinstance(error, PyMongoError):
            raise HTTPException(503, f"MongoDB no responde: no se pudo {self._que}.") from error
        return False


def _respuesta(documento: dict) -> dict:
    """Documento → forma del contrato: `id` en texto, `date` ISO 8601, sin `_id`."""
    salida = {"id": str(documento["_id"]), **{k: v for k, v in documento.items() if k != "_id"}}
    if isinstance(salida.get("date"), datetime):
        salida["date"] = salida["date"].isoformat()
    return salida


def _resumen(documento: dict) -> dict:
    """Fila del listado. `weeks` y `mape` son nulos en una corrida no disponible."""
    parametros = documento.get("parameters", {})
    fecha = documento.get("date")
    return {
        "id": str(documento["_id"]),
        "date": fecha.isoformat() if isinstance(fecha, datetime) else fecha,
        "userId": documento.get("userId"),
        "productId": parametros.get("productId"),
        "zoneId": parametros.get("zoneId"),
        "unit": documento.get("product", {}).get("unit"),
        "disponible": documento.get("disponible"),
        "weeks": documento.get("dataVersion", {}).get("weeks"),
        "mape": documento.get("validation", {}).get("mape"),
        "durationMs": documento.get("durationMs"),
    }


_cliente: MongoClient | None = None


def obtener_corridas() -> Corridas:
    """Dependencia de ruta. Un solo cliente (con su pool) para todo el proceso."""
    global _cliente
    if _cliente is None:
        _cliente = MongoClient(os.getenv("MONGO_URL", "mongodb://localhost:27017/retaildb"), tz_aware=True,
                               serverSelectionTimeoutMS=TIMEOUT_MS, connectTimeoutMS=TIMEOUT_MS,
                               # También a una conexión ya abierta: sin esto espera sin límite.
                               socketTimeoutMS=TIMEOUT_MS)
    return Corridas(_cliente)
