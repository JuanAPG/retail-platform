"""Corridas de clustering en MongoDB (D3), colección `analysis_runs`.

Cada documento es la corrida completa con su entrada (la foto de D-15) y solo
el `userId` (D-26). Si Mongo no responde → 503 (D-25): la corrida no se
devuelve sin guardar.
"""
from __future__ import annotations

import os
from datetime import datetime

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from pymongo import DESCENDING, MongoClient
from pymongo.errors import PyMongoError

COLECCION = "analysis_runs"
TIPO = "clustering"
#: Mongo caído debe responder rápido (D-25), no colgar la petición.
TIMEOUT_MS = 2000

#: Lo que el listado no trae (contrato: GET /v1/clustering/runs).
_SOLO_EN_DETALLE = ("input", "clusters", "assignments", "excludedZones", "assumptions")


class Corridas:
    def __init__(self, cliente: MongoClient):
        self._coleccion = cliente.get_default_database()[COLECCION]
        self._con_indice = False

    def guardar(self, corrida: dict) -> dict:
        # `zoneCount` es para el listado, que no trae las asignaciones. La fecha va
        # en milisegundos, como la guarda BSON: así el 201 es igual a lo que se relee.
        documento = {**corrida, "type": TIPO, "zoneCount": len(corrida["assignments"])}
        if isinstance(documento.get("date"), datetime):
            fecha = documento["date"]
            documento["date"] = fecha.replace(microsecond=fecha.microsecond // 1000 * 1000)
        with _sin_mongo("guardar la corrida"):
            self._indice()
            documento["_id"] = self._coleccion.insert_one(documento).inserted_id
        return _respuesta(documento)

    def listar(self, pagina: int, limite: int) -> tuple[list[dict], int]:
        with _sin_mongo("leer las corridas"):
            total = self._coleccion.count_documents({"type": TIPO})
            cursor = (self._coleccion.find({"type": TIPO}, {campo: 0 for campo in _SOLO_EN_DETALLE})
                      .sort([("date", DESCENDING), ("_id", DESCENDING)])
                      .skip((pagina - 1) * limite).limit(limite))
            return [_respuesta(d, resumen=True) for d in cursor], total

    def obtener(self, id_corrida: str) -> dict:
        try:
            clave = ObjectId(id_corrida)
        except (InvalidId, TypeError):
            raise HTTPException(400, f"'{id_corrida}' no es un id de corrida (ObjectId de 24 caracteres hex).") from None
        with _sin_mongo("leer la corrida"):
            documento = self._coleccion.find_one({"_id": clave, "type": TIPO})
        if documento is None:
            raise HTTPException(404, f"No existe la corrida de clustering {id_corrida}.")
        return _respuesta(documento)

    def _indice(self) -> None:
        # Las corridas de un usuario, de la más reciente a la más antigua (QA ALG-04 / STA-03).
        if not self._con_indice:
            self._coleccion.create_index([("userId", 1), ("date", DESCENDING)], name="userId_date")
            self._con_indice = True


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


def _respuesta(documento: dict, resumen: bool = False) -> dict:
    """Documento → forma del contrato: `id` en texto, `date` ISO 8601, sin `_id`.

    `zoneCount` solo va en el listado (`clusteringRunSummary`); el detalle trae
    las asignaciones completas.
    """
    salida = {"id": str(documento["_id"]), **{k: v for k, v in documento.items() if k != "_id"}}
    if isinstance(salida.get("date"), datetime):
        salida["date"] = salida["date"].isoformat()
    if not resumen:
        salida.pop("zoneCount", None)
    return salida


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


def verificar_mongo() -> str:
    """Para `/v1/health`: `ok`, `no configurado` o el motivo. Nunca lanza."""
    if not os.getenv("MONGO_URL"):
        return "no configurado"
    try:
        obtener_corridas()  # Crea el cliente si hace falta.
        _cliente.admin.command("ping")
        return "ok"
    except Exception as error:  # noqa: BLE001 - el health reporta, no falla
        return f"error: {error}"
