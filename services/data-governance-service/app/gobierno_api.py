"""Rutas de data-governance-service (contrato `data-governance-service.md`, D-43).

Permisos (Matriz §3.2): el Administrador escribe fuentes y versiones; registran linaje el Analista,
el Responsable de precios y el Planeador (los servicios lo llaman con el token de quien hizo la
operación); el linaje lo leen Administrador y Auditor todo y los demás internos solo lo propio
(DG-6, 404 para lo ajeno); calidad: Administrador, Auditor y Analista; retención: Administrador y
Auditor. Proveedor e Investigador → 403 en todas.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import avisos, ejemplos
from .dominio import (CLAVE_FUENTE, CONJUNTOS, SERVICIOS, TIPOS_FUENTE, TIPOS_RECURSO, ErrorDominio,
                      dias_frescura_segmentos, dias_frescura_ventas)
from .fuentes import Fuentes, obtener_fuentes
from .informes import FUENTES_MEDIBLES, evaluacion, reporte_calidad
from .origen import construir
from .pagination import normalizar
from .repositorio import Repositorio, obtener_repositorio
from .retencion import simular
from .roles import PERFILES_INTERNOS, ROL, requiere_roles

router = APIRouter(tags=["Gobierno de datos (D-43)"])

RAICES_XML = {
    "GET /v1/sources": "sourceListResponse",
    "POST /v1/sources": "sourceResponse",
    "/v1/sources/*": "sourceResponse",
    "GET /v1/sources/*/versions": "sourceVersionListResponse",
    "POST /v1/sources/*/versions": "sourceVersionResponse",
    "GET /v1/lineage": "lineageListResponse",
    "POST /v1/lineage": "lineageRecordResponse",
    "/v1/lineage/*": "lineageRecordResponse",
    "/v1/lineage/*/origin": "lineageOriginResponse",
    "/v1/quality-report": "qualityReportResponse",
    "/v1/retention-policies": "retentionPolicyListResponse",
    "/v1/retention/evaluation": "retentionEvaluationResponse",
    "/v1/retention/simulate": "retentionSimulationResponse",
}

_ZONA = ZoneInfo("America/Monterrey")
_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_OBJECT_ID = re.compile(r"^[0-9a-fA-F]{24}$")
_VERSION_SEGMENTO = re.compile(r"^\d+:\d+$")
#: DG-6: ven solo lo propio.
_SOLO_LO_PROPIO = {ROL.ANALISTA, ROL.GERENTE_CATEGORIA, ROL.RESPONSABLE_PRECIOS, ROL.PLANEADOR}

_ADMIN = Depends(requiere_roles(ROL.ADMINISTRADOR))
_INTERNOS = Depends(requiere_roles(*PERFILES_INTERNOS))
_REGISTRAN = Depends(requiere_roles(ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS, ROL.PLANEADOR))
_CALIDAD = Depends(requiere_roles(ROL.ADMINISTRADOR, ROL.AUDITOR, ROL.ANALISTA))
_RETENCION = Depends(requiere_roles(ROL.ADMINISTRADOR, ROL.AUDITOR))


# --- Utilidades de validación (todo error es 400)

def _solo(request: Request, permitidos: set[str]) -> None:
    sobran = sorted(set(request.query_params) - permitidos)
    if sobran:
        raise HTTPException(400, f"Parámetro desconocido: {', '.join(sobran)}.")


def _pagina(page: int | None, limit: int | None) -> tuple[int, int]:
    try:
        return normalizar(page, limit)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


def _fecha(valor: str | None, campo: str) -> date | None:
    if valor is None:
        return None
    try:
        if not _FECHA.match(valor):
            raise ValueError
        return date.fromisoformat(valor)
    except ValueError:
        raise HTTPException(400, f"{campo} debe ser una fecha YYYY-MM-DD válida.") from None


def _hoy() -> date:
    return datetime.now(_ZONA).date()


def _dominio(error: ErrorDominio) -> HTTPException:
    return HTTPException(error.status, error.mensaje)


def _solo_de(usuario: dict) -> str | None:
    return usuario["id"] if usuario["rol"] in _SOLO_LO_PROPIO else None


# --- Cuerpos

def _id_valido(tipo: str, valor: str) -> bool:
    """DG-4: importacion = UUID; version_segmento = "{segmentId}:{version}"; corrida = ObjectId o UUID."""
    if tipo == "importacion":
        return bool(_UUID.match(valor))
    if tipo == "version_segmento":
        return bool(_VERSION_SEGMENTO.match(valor))
    return bool(_OBJECT_ID.match(valor) or _UUID.match(valor))


class Referencia(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: str
    resourceType: Literal[TIPOS_RECURSO]
    resourceId: str = Field(min_length=1, max_length=100)

    @field_validator("service")
    @classmethod
    def _servicio(cls, valor):
        if valor not in SERVICIOS:
            raise ValueError("service debe ser uno de los 20 servicios.")
        return valor

    @model_validator(mode="after")
    def _formato(self):
        if not _id_valido(self.resourceType, self.resourceId):
            raise ValueError(f"resourceId no tiene el formato de un recurso {self.resourceType} (DG-4).")
        return self


class FuenteUsada(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=CLAVE_FUENTE.pattern)
    version: str = Field(min_length=1, max_length=100)


class LinajeDto(Referencia):
    description: str | None = Field(default=None, max_length=300)
    source: FuenteUsada
    inputs: list[Referencia] = Field(default_factory=list, max_length=50)
    occurredAt: datetime

    @field_validator("occurredAt")
    @classmethod
    def _con_zona(cls, valor):
        if valor.tzinfo is None:
            raise ValueError("occurredAt debe llevar zona horaria (ISO 8601).")
        return valor

    @model_validator(mode="after")
    def _insumos_distintos(self):
        refs = [(i.service, i.resourceType, i.resourceId) for i in self.inputs]
        if len(refs) != len(set(refs)):
            raise ValueError("inputs no puede repetir referencias.")
        return self


class FuenteDto(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=CLAVE_FUENTE.pattern)
    name: str = Field(min_length=1, max_length=120)
    type: Literal[TIPOS_FUENTE]
    ownerService: str
    description: str | None = Field(default=None, max_length=1000)

    @field_validator("ownerService")
    @classmethod
    def _dueno(cls, valor):
        if valor not in SERVICIOS:
            raise ValueError("ownerService debe ser uno de los 20 servicios.")
        return valor


class CambioFuenteDto(BaseModel):
    """`key` y `type` no cambian: si vienen, 400 (campo no permitido)."""
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    ownerService: str | None = None
    active: bool | None = None

    @field_validator("ownerService")
    @classmethod
    def _dueno(cls, valor):
        if valor is not None and valor not in SERVICIOS:
            raise ValueError("ownerService debe ser uno de los 20 servicios.")
        return valor


class VersionDto(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=300)


class RegistroSimuladoDto(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataset: Literal[CONJUNTOS]
    recordId: str = Field(min_length=1, max_length=60)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")

    @field_validator("date")
    @classmethod
    def _fecha_valida(cls, valor):
        date.fromisoformat(valor)
        return valor


class SimulacionDto(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asOf: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    records: list[RegistroSimuladoDto]


# --- Fuentes y versiones

@router.get("/v1/sources", summary="Fuentes de datos registradas (paginado, por clave).",
            responses={200: ejemplos.respuesta("Página de fuentes.", ejemplos.FUENTES, "sourceListResponse"),
                       **ejemplos.errores("/v1/sources", 400, 401, 403, 503)})
def listar_fuentes(request: Request,
                   type: Annotated[Literal[TIPOS_FUENTE] | None, Query()] = None,
                   ownerService: Annotated[str | None, Query()] = None,
                   active: Annotated[bool | None, Query()] = None,
                   page: Annotated[int | None, Query()] = None, limit: Annotated[int | None, Query()] = None,
                   _usuario: dict = _INTERNOS, repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    _solo(request, {"type", "ownerService", "active", "page", "limit"})
    pagina, tope = _pagina(page, limit)
    datos, total = repo.listar_fuentes(type, ownerService, active, pagina, tope)
    return {"data": datos, "total": total, "page": pagina, "limit": tope}


@router.post("/v1/sources", status_code=201, summary="Alta de una fuente. Solo Administrador.",
             responses={201: ejemplos.respuesta("La fuente creada.", ejemplos.FUENTE, "sourceResponse"),
                        **ejemplos.errores("/v1/sources", 400, 401, 403, 409, 503)})
def crear_fuente(cuerpo: FuenteDto, request: Request, tareas: BackgroundTasks, usuario: dict = _ADMIN,
                 repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    try:
        fuente = repo.crear_fuente(cuerpo.model_dump(), usuario["id"])
    except ErrorDominio as error:
        raise _dominio(error) from error
    tareas.add_task(avisos.fuente_creada, fuente, avisos.contexto(request))
    return fuente


@router.get("/v1/sources/{clave}", summary="Una fuente con su versión actual.",
            responses={200: ejemplos.respuesta("La fuente.", ejemplos.FUENTE, "sourceResponse"),
                       **ejemplos.errores("/v1/sources/{clave}", 401, 403, 404, 503)})
def obtener_fuente(clave: str, _usuario: dict = _INTERNOS, repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    return repo.obtener_fuente(clave)


@router.patch("/v1/sources/{clave}", summary="Cambia nombre, descripción, dueño o activa. Solo Administrador.",
              description="`key` y `type` no cambian (400). Una fuente nunca se borra: `active: false` la desactiva.",
              responses={200: ejemplos.respuesta("La fuente después del cambio.", ejemplos.FUENTE, "sourceResponse"),
                         **ejemplos.errores("/v1/sources/{clave}", 400, 401, 403, 404, 503)})
def cambiar_fuente(clave: str, cuerpo: CambioFuenteDto, request: Request, tareas: BackgroundTasks,
                   _usuario: dict = _ADMIN, repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    antes, despues = repo.actualizar_fuente(clave, cuerpo.model_dump(exclude_unset=True))
    tareas.add_task(avisos.fuente_cambiada, antes, despues, avisos.contexto(request))
    return despues


@router.get("/v1/sources/{clave}/versions", summary="Versiones de una fuente, la más reciente primero.",
            responses={200: ejemplos.respuesta("Página de versiones.", ejemplos.VERSIONES, "sourceVersionListResponse"),
                       **ejemplos.errores("/v1/sources/{clave}/versions", 400, 401, 403, 404, 503)})
def listar_versiones(clave: str, request: Request, page: Annotated[int | None, Query()] = None,
                     limit: Annotated[int | None, Query()] = None, _usuario: dict = _INTERNOS,
                     repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    _solo(request, {"page", "limit"})
    pagina, tope = _pagina(page, limit)
    datos, total = repo.listar_versiones(clave, pagina, tope)
    return {"data": datos, "total": total, "page": pagina, "limit": tope}


@router.post("/v1/sources/{clave}/versions", status_code=201, summary="Alta manual de una versión. Solo Administrador.",
             responses={201: ejemplos.respuesta("La versión creada.", ejemplos.VERSION, "sourceVersionResponse"),
                        **ejemplos.errores("/v1/sources/{clave}/versions", 400, 401, 403, 404, 409, 503)})
def crear_version(clave: str, cuerpo: VersionDto, request: Request, tareas: BackgroundTasks, usuario: dict = _ADMIN,
                  repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    try:
        nueva = repo.crear_version(clave, cuerpo.version, cuerpo.description, usuario["id"])
    except ErrorDominio as error:
        raise _dominio(error) from error
    tareas.add_task(avisos.version_creada, nueva, avisos.contexto(request))
    return nueva


# --- Linaje

@router.post("/v1/lineage", status_code=201,
             summary="Registra el linaje de un recurso (idempotente): 201 la primera vez, 200 si ya existía igual.",
             description="La llave es service + resourceType + resourceId (DG-3). Mismo recurso con otro contenido → "
                         "409: el linaje no se sobrescribe. `userId` sale del token y `correlationId` del encabezado.",
             responses={201: ejemplos.respuesta("Registro creado.", ejemplos.REGISTRO, "lineageRecordResponse"),
                        200: ejemplos.respuesta("Ya existía igual.", ejemplos.REGISTRO, "lineageRecordResponse"),
                        **ejemplos.errores("/v1/lineage", 400, 401, 403, 409, 503)})
def registrar_linaje(cuerpo: Annotated[LinajeDto, Body(openapi_examples={"corrida": {"value": ejemplos.CUERPO_LINAJE}})],
                     request: Request, respuesta: Response, usuario: dict = _REGISTRAN,
                     repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    try:
        registro, creado = repo.registrar(cuerpo.model_dump(mode="json"), usuario["id"],
                                          request.headers.get("x-correlation-id"))
    except ErrorDominio as error:
        raise _dominio(error) from error
    if not creado:
        respuesta.status_code = 200
    return registro


@router.get("/v1/lineage", summary="Registros de linaje, el más reciente primero (solo los propios para quien ve lo propio).",
            responses={200: ejemplos.respuesta("Página de registros.", ejemplos.REGISTROS, "lineageListResponse"),
                       **ejemplos.errores("/v1/lineage", 400, 401, 403, 503)})
def listar_linaje(request: Request, service: Annotated[str | None, Query()] = None,
                  resourceType: Annotated[Literal[TIPOS_RECURSO] | None, Query()] = None,
                  resourceId: Annotated[str | None, Query()] = None, sourceKey: Annotated[str | None, Query()] = None,
                  page: Annotated[int | None, Query()] = None, limit: Annotated[int | None, Query()] = None,
                  usuario: dict = _INTERNOS, repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    _solo(request, {"service", "resourceType", "resourceId", "sourceKey", "page", "limit"})
    pagina, tope = _pagina(page, limit)
    filtros = {"service": service, "resourceType": resourceType, "resourceId": resourceId, "sourceKey": sourceKey}
    datos, total = repo.listar_registros(filtros, _solo_de(usuario), pagina, tope)
    return {"data": datos, "total": total, "page": pagina, "limit": tope}


@router.get("/v1/lineage/{id_registro}", summary="Un registro de linaje. Ajeno para quien ve lo propio → 404 (DG-6).",
            responses={200: ejemplos.respuesta("El registro.", ejemplos.REGISTRO, "lineageRecordResponse"),
                       **ejemplos.errores("/v1/lineage/{id_registro}", 401, 403, 404, 503)})
def obtener_linaje(id_registro: str, usuario: dict = _INTERNOS,
                   repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    return repo.obtener_registro(id_registro, _solo_de(usuario))


@router.get("/v1/lineage/{id_registro}/origin", summary="¿De dónde salió este resultado? Árbol hacia atrás (DG-5).",
            description="Hasta 5 niveles (`truncated: true` si hay más); un ciclo se corta. Un insumo sin linaje sale "
                        "`registered: false`; uno ajeno, para quien ve lo propio, `restricted: true` (DG-6).",
            responses={200: ejemplos.respuesta("El árbol de origen.", ejemplos.ORIGEN, "lineageOriginResponse"),
                       **ejemplos.errores("/v1/lineage/{id_registro}/origin", 401, 403, 404, 503)})
def origen(id_registro: str, usuario: dict = _INTERNOS, repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    solo_de = _solo_de(usuario)
    raiz = repo.obtener_registro(id_registro, solo_de)
    fuentes = {f["key"]: f for f in repo.listar_fuentes(None, None, None, 1, 10_000)[0]}

    def fuente(clave: str) -> dict:
        f = fuentes[clave]
        return {"key": f["key"], "name": f["name"], "type": f["type"], "ownerService": f["ownerService"]}

    def version(clave: str, nombre: str) -> dict:
        v = repo.version_de(clave, nombre)
        return {"version": v["version"], "createdAt": v["createdAt"], "origin": v["origin"]}

    return construir(raiz, repo.buscar, lambda r: solo_de is None or r["userId"] == solo_de, fuente, version)


# --- Calidad

@router.get("/v1/quality-report", summary="Calidad por fuente: completitud, duplicados, fuera de rango y frescura.",
            description="Calcula al momento con lo que exponen los dueños (DG-7, DG-8). Una métrica que no se puede "
                        "medir sale `disponible: false` con motivo, nunca 0; un dueño caído afecta solo a su fuente.",
            responses={200: ejemplos.respuesta("El reporte.", ejemplos.CALIDAD, "qualityReportResponse"),
                       **ejemplos.errores("/v1/quality-report", 400, 401, 403, 404, 503)})
def calidad(request: Request, dateFrom: Annotated[str | None, Query()] = None,
            dateTo: Annotated[str | None, Query()] = None, sourceKey: Annotated[str | None, Query()] = None,
            _usuario: dict = _CALIDAD, repo: Repositorio = Depends(obtener_repositorio),
            fuentes: Fuentes = Depends(obtener_fuentes)) -> dict:
    _solo(request, {"dateFrom", "dateTo", "sourceKey"})
    desde, hasta = _fecha(dateFrom, "dateFrom"), _fecha(dateTo, "dateTo")
    if desde and hasta and desde > hasta:
        raise HTTPException(400, "dateFrom no puede ser posterior a dateTo.")
    registradas = {f["key"]: f for f in repo.listar_fuentes(None, None, None, 1, 10_000)[0]}
    if sourceKey is not None:
        if sourceKey not in registradas:
            raise HTTPException(404, f"No existe la fuente {sourceKey}.")
        if sourceKey not in FUENTES_MEDIBLES:
            raise HTTPException(400, f"La fuente {sourceKey} no tiene métricas de calidad; las que sí: "
                                     f"{', '.join(FUENTES_MEDIBLES)}.")
    return reporte_calidad(registradas, fuentes, desde, hasta, sourceKey, _hoy(),
                           datetime.now(timezone.utc).isoformat(timespec="microseconds"),
                           dias_frescura_ventas(), dias_frescura_segmentos())


# --- Retención

@router.get("/v1/retention-policies", summary="Políticas de retención de D-43 (solo lectura).",
            responses={200: ejemplos.respuesta("Las políticas.", ejemplos.POLITICAS, "retentionPolicyListResponse"),
                       **ejemplos.errores("/v1/retention-policies", 401, 403, 503)})
def politicas(_usuario: dict = _RETENCION, repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    return {"data": repo.politicas()}


@router.get("/v1/retention/evaluation", summary="Qué datos vencerían en `asOf` según D-43, pedidos a cada dueño.",
            description="Un `asOf` futuro simula el vencimiento sobre los datos reales sin tocar nada (DG-10). Si el "
                        "dueño no expone el conteo, ese conjunto sale `disponible: false`, nunca 0.",
            responses={200: ejemplos.respuesta("La evaluación.", ejemplos.EVALUACION, "retentionEvaluationResponse"),
                       **ejemplos.errores("/v1/retention/evaluation", 400, 401, 403, 503)})
def evaluar(request: Request, asOf: Annotated[str | None, Query()] = None, _usuario: dict = _RETENCION,
            repo: Repositorio = Depends(obtener_repositorio), fuentes: Fuentes = Depends(obtener_fuentes)) -> dict:
    _solo(request, {"asOf"})
    return evaluacion(repo.politicas(), fuentes, _fecha(asOf, "asOf") or _hoy())


@router.post("/v1/retention/simulate", summary="Aplica DG-9 a registros sintéticos (máximo 1 000). No lee ni escribe nada.",
             responses={200: ejemplos.respuesta("La simulación.", ejemplos.SIMULACION, "retentionSimulationResponse"),
                        **ejemplos.errores("/v1/retention/simulate", 400, 401, 403, 503)})
def simular_retencion(cuerpo: Annotated[SimulacionDto, Body(openapi_examples={"contrato": {"value": ejemplos.CUERPO_SIMULACION}})],
                      _usuario: dict = _RETENCION, repo: Repositorio = Depends(obtener_repositorio)) -> dict:
    plazos = {p["dataset"]: p["retentionPeriod"] for p in repo.politicas()}
    try:
        as_of = date.fromisoformat(cuerpo.asOf)
    except ValueError:
        raise HTTPException(400, "asOf no es una fecha válida.") from None
    try:
        return simular(as_of, [r.model_dump() for r in cuerpo.records], plazos)
    except ErrorDominio as error:
        raise _dominio(error) from error
