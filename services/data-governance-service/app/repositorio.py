"""Tablas propias en PostgreSQL (D-47): fuentes, versiones, linaje y políticas de retención.

SQL plano con un pool de conexiones. Postgres caído → 503 (D-25). El linaje y las versiones solo
se anexan: además del código, los triggers de la migración impiden UPDATE y DELETE.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime

import psycopg2
import psycopg2.errors
import psycopg2.extras
import psycopg2.pool
from fastapi import HTTPException

from .dominio import ErrorDominio

TIMEOUT_S = 2

_FUENTE = """SELECT f.clave, f.nombre, f.tipo, f.servicio_dueno, f.descripcion, f.activa, f.creado_en, f.creado_por,
       (SELECT v.version FROM fuente_versiones v WHERE v.fuente_clave = f.clave
         ORDER BY v.creado_en DESC, v.id DESC LIMIT 1) AS version_actual
  FROM fuentes_datos f"""
_REGISTRO = """SELECT r.id, r.servicio, r.tipo_recurso, r.recurso_id, r.descripcion, r.fuente_clave, r.fuente_version,
       r.ocurrido_en, r.usuario_id, r.correlation_id, r.registrado_en,
       COALESCE((SELECT json_agg(json_build_object('service', i.servicio, 'resourceType', i.tipo_recurso,
                                                   'resourceId', i.recurso_id) ORDER BY i.orden)
                   FROM linaje_insumos i WHERE i.registro_id = r.id), '[]'::json) AS insumos
  FROM linaje_registros r"""


def _iso(valor: datetime | None) -> str | None:
    return valor.isoformat(timespec="microseconds") if valor else None


def _str(valor) -> str | None:
    return None if valor is None else str(valor)


def fuente(fila: dict) -> dict:
    return {"key": fila["clave"], "name": fila["nombre"], "type": fila["tipo"], "ownerService": fila["servicio_dueno"],
            "description": fila["descripcion"], "active": fila["activa"], "currentVersion": fila["version_actual"],
            "createdAt": _iso(fila["creado_en"]), "createdBy": _str(fila["creado_por"])}


def version(fila: dict) -> dict:
    return {"sourceKey": fila["fuente_clave"], "version": fila["version"], "description": fila["descripcion"],
            "origin": fila["origen"], "createdAt": _iso(fila["creado_en"]), "createdBy": _str(fila["creado_por"])}


def registro(fila: dict) -> dict:
    return {"id": str(fila["id"]), "service": fila["servicio"], "resourceType": fila["tipo_recurso"],
            "resourceId": fila["recurso_id"], "description": fila["descripcion"],
            "source": {"key": fila["fuente_clave"], "version": fila["fuente_version"]},
            "inputs": fila["insumos"], "occurredAt": _iso(fila["ocurrido_en"]), "userId": str(fila["usuario_id"]),
            "correlationId": fila["correlation_id"], "registeredAt": _iso(fila["registrado_en"])}


class Repositorio:
    def __init__(self, pool: psycopg2.pool.AbstractConnectionPool):
        self._pool = pool

    @contextmanager
    def _cursor(self):
        """Una transacción: commit al salir bien, rollback si algo falla. Postgres caído → 503."""
        try:
            conexion = self._pool.getconn()
        except (psycopg2.OperationalError, psycopg2.pool.PoolError) as error:
            raise HTTPException(503, "PostgreSQL no responde.") from error
        try:
            with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                yield cursor
            conexion.commit()
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as error:
            raise HTTPException(503, "PostgreSQL no responde.") from error
        except BaseException:
            if not conexion.closed:
                conexion.rollback()
            raise
        finally:
            self._pool.putconn(conexion, close=bool(conexion.closed))

    # --- Fuentes (DG-1)

    def listar_fuentes(self, tipo: str | None, dueno: str | None, activa: bool | None,
                       pagina: int, limite: int) -> tuple[list[dict], int]:
        condiciones, params = [], []
        for columna, valor in (("f.tipo", tipo), ("f.servicio_dueno", dueno), ("f.activa", activa)):
            if valor is not None:
                condiciones.append(f"{columna} = %s")
                params.append(valor)
        donde = f" WHERE {' AND '.join(condiciones)}" if condiciones else ""
        with self._cursor() as c:
            c.execute(f"SELECT count(*) AS n FROM fuentes_datos f{donde}", params)
            total = c.fetchone()["n"]
            c.execute(f"{_FUENTE}{donde} ORDER BY f.clave LIMIT %s OFFSET %s", [*params, limite, (pagina - 1) * limite])
            return [fuente(f) for f in c.fetchall()], total

    def obtener_fuente(self, clave: str) -> dict:
        with self._cursor() as c:
            c.execute(f"{_FUENTE} WHERE f.clave = %s", [clave])
            fila = c.fetchone()
        if fila is None:
            raise HTTPException(404, f"No existe la fuente {clave}.")
        return fuente(fila)

    def crear_fuente(self, datos: dict, usuario_id: str) -> dict:
        try:
            with self._cursor() as c:
                c.execute("""INSERT INTO fuentes_datos (clave, nombre, tipo, servicio_dueno, descripcion, creado_por)
                             VALUES (%s, %s, %s, %s, %s, %s)""",
                          [datos["key"], datos["name"], datos["type"], datos["ownerService"], datos.get("description"),
                           usuario_id])
        except psycopg2.errors.UniqueViolation:
            raise ErrorDominio(f"Ya existe la fuente {datos['key']}.", 409) from None
        return self.obtener_fuente(datos["key"])

    def actualizar_fuente(self, clave: str, cambios: dict) -> tuple[dict, dict]:
        """`cambios` con nombres del contrato (`name`, `description`, `ownerService`, `active`).
        Devuelve (antes, después) para la bitácora."""
        columnas = {"name": "nombre", "description": "descripcion", "ownerService": "servicio_dueno", "active": "activa"}
        antes = self.obtener_fuente(clave)
        if cambios:
            asignaciones = ", ".join(f"{columnas[k]} = %s" for k in cambios)
            with self._cursor() as c:
                c.execute(f"UPDATE fuentes_datos SET {asignaciones}, actualizado_en = now() WHERE clave = %s",
                          [*cambios.values(), clave])
        return antes, self.obtener_fuente(clave)

    # --- Versiones (DG-2)

    def listar_versiones(self, clave: str, pagina: int, limite: int) -> tuple[list[dict], int]:
        self.obtener_fuente(clave)  # 404
        with self._cursor() as c:
            c.execute("SELECT count(*) AS n FROM fuente_versiones WHERE fuente_clave = %s", [clave])
            total = c.fetchone()["n"]
            c.execute("""SELECT * FROM fuente_versiones WHERE fuente_clave = %s
                         ORDER BY creado_en DESC, id DESC LIMIT %s OFFSET %s""", [clave, limite, (pagina - 1) * limite])
            return [version(v) for v in c.fetchall()], total

    def crear_version(self, clave: str, nueva: str, descripcion: str | None, usuario_id: str) -> dict:
        self.obtener_fuente(clave)  # 404
        try:
            with self._cursor() as c:
                c.execute("""INSERT INTO fuente_versiones (fuente_clave, version, descripcion, origen, creado_por)
                             VALUES (%s, %s, %s, 'manual', %s) RETURNING *""", [clave, nueva, descripcion, usuario_id])
                return version(c.fetchone())
        except psycopg2.errors.UniqueViolation:
            raise ErrorDominio(f"La fuente {clave} ya tiene la versión {nueva}.", 409) from None

    def version_de(self, clave: str, nombre: str) -> dict | None:
        with self._cursor() as c:
            c.execute("SELECT * FROM fuente_versiones WHERE fuente_clave = %s AND version = %s", [clave, nombre])
            fila = c.fetchone()
        return version(fila) if fila else None

    # --- Linaje (DG-3 a DG-6)

    def registrar(self, cuerpo: dict, usuario_id: str, correlacion: str | None) -> tuple[dict, bool]:
        """DG-3: (registro, creado). Mismo cuerpo otra vez → el existente (200); otro contenido → 409.
        Una versión nueva de una fuente existente se crea sola (`origin: linaje`, DG-2)."""
        llave = (cuerpo["service"], cuerpo["resourceType"], cuerpo["resourceId"])
        existente = self.buscar(llave)
        if existente is not None:
            return self._mismo_o_conflicto(existente, cuerpo), False
        fuente_usada = cuerpo["source"]
        try:
            with self._cursor() as c:
                c.execute("SELECT activa FROM fuentes_datos WHERE clave = %s", [fuente_usada["key"]])
                fila = c.fetchone()
                if fila is None or not fila["activa"]:
                    estado = "no existe" if fila is None else "está inactiva"
                    raise ErrorDominio(f"La fuente {fuente_usada['key']} {estado}: no se le puede registrar linaje (DG-1).")
                c.execute("""INSERT INTO fuente_versiones (fuente_clave, version, origen, creado_por)
                             VALUES (%s, %s, 'linaje', %s) ON CONFLICT ON CONSTRAINT uq_fuente_version DO NOTHING""",
                          [fuente_usada["key"], fuente_usada["version"], usuario_id])
                c.execute("""INSERT INTO linaje_registros (servicio, tipo_recurso, recurso_id, descripcion, fuente_clave,
                                 fuente_version, ocurrido_en, usuario_id, correlation_id)
                             VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                          [*llave, cuerpo.get("description"), fuente_usada["key"], fuente_usada["version"],
                           cuerpo["occurredAt"], usuario_id, correlacion])
                nuevo_id = c.fetchone()["id"]
                if cuerpo.get("inputs"):
                    psycopg2.extras.execute_values(
                        c, "INSERT INTO linaje_insumos (registro_id, orden, servicio, tipo_recurso, recurso_id) VALUES %s",
                        [(nuevo_id, i, x["service"], x["resourceType"], x["resourceId"])
                         for i, x in enumerate(cuerpo["inputs"])])
        except psycopg2.errors.UniqueViolation:
            # Dos registros iguales al mismo tiempo: el otro ganó. Se compara contra el que quedó.
            return self._mismo_o_conflicto(self.buscar(llave), cuerpo), False
        return self.buscar(llave), True

    def _mismo_o_conflicto(self, existente: dict, cuerpo: dict) -> dict:
        def normal(x: dict) -> tuple:
            return (x.get("description"), x["source"]["key"], x["source"]["version"],
                    datetime.fromisoformat(str(x["occurredAt"]).replace("Z", "+00:00")),
                    tuple((i["service"], i["resourceType"], i["resourceId"]) for i in x.get("inputs") or []))

        if normal(existente) != normal(cuerpo):
            raise ErrorDominio(
                f"El recurso {cuerpo['service']}/{cuerpo['resourceType']}/{cuerpo['resourceId']} ya tiene linaje con "
                "otro contenido; el linaje no se sobrescribe (DG-3).", 409)
        return existente

    def buscar(self, llave: tuple[str, str, str]) -> dict | None:
        with self._cursor() as c:
            c.execute(f"{_REGISTRO} WHERE r.servicio = %s AND r.tipo_recurso = %s AND r.recurso_id = %s", list(llave))
            fila = c.fetchone()
        return registro(fila) if fila else None

    def obtener_registro(self, id_registro: str, solo_de: str | None) -> dict:
        """DG-6: para quien solo ve lo propio, un registro ajeno es 404, igual que uno inexistente."""
        no_existe = HTTPException(404, f"No existe el registro de linaje {id_registro}.")
        with self._cursor() as c:
            try:
                c.execute(f"{_REGISTRO} WHERE r.id = %s", [id_registro])
            except psycopg2.errors.InvalidTextRepresentation:
                raise no_existe from None
            fila = c.fetchone()
        if fila is None or (solo_de is not None and str(fila["usuario_id"]) != solo_de):
            raise no_existe
        return registro(fila)

    def listar_registros(self, filtros: dict, solo_de: str | None, pagina: int, limite: int) -> tuple[list[dict], int]:
        columnas = {"service": "r.servicio", "resourceType": "r.tipo_recurso", "resourceId": "r.recurso_id",
                    "sourceKey": "r.fuente_clave"}
        condiciones, params = [], []
        for campo, valor in filtros.items():
            if valor is not None:
                condiciones.append(f"{columnas[campo]} = %s")
                params.append(valor)
        if solo_de is not None:
            condiciones.append("r.usuario_id = %s")
            params.append(solo_de)
        donde = f" WHERE {' AND '.join(condiciones)}" if condiciones else ""
        with self._cursor() as c:
            c.execute(f"SELECT count(*) AS n FROM linaje_registros r{donde}", params)
            total = c.fetchone()["n"]
            c.execute(f"{_REGISTRO}{donde} ORDER BY r.registrado_en DESC, r.id DESC LIMIT %s OFFSET %s",
                      [*params, limite, (pagina - 1) * limite])
            return [registro(f) for f in c.fetchall()], total

    # --- Políticas de retención (D-43)

    def politicas(self) -> list[dict]:
        with self._cursor() as c:
            c.execute("SELECT * FROM politicas_retencion ORDER BY orden")
            return [{"dataset": p["conjunto"], "ownerService": p["servicio_dueno"], "retentionPeriod": p["plazo"],
                     "basis": p["base"], "ownerAction": p["accion_dueno"], "decision": p["decision"]}
                    for p in c.fetchall()]


_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def obtener_repositorio() -> Repositorio:
    """Dependencia de ruta. Un solo pool para todo el proceso; si Postgres no está, 503 (D-25)."""
    global _pool
    if _pool is None:
        try:
            _pool = psycopg2.pool.ThreadedConnectionPool(
                1, 8, host=os.getenv("DB_HOST", "localhost"), port=int(os.getenv("DB_PORT", "5432")),
                user=os.getenv("DB_USER", "retail_user"), password=os.getenv("DB_PASSWORD", ""),
                dbname=os.getenv("DB_NAME", "retaildb"), connect_timeout=TIMEOUT_S)
        except psycopg2.OperationalError as error:
            raise HTTPException(503, "PostgreSQL no responde.") from error
    return Repositorio(_pool)
