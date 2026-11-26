"""Rutas del pronóstico de demanda (contrato `demand-forecast-service.md`, D-40).

Lanzar un cálculo (`run`, `replay`) es del Analista comercial; las corridas guardadas las leen
los 6 perfiles internos (Matriz §3.2, mismo criterio que D-24). Proveedor e Investigador → 403.
"""
from __future__ import annotations

import json
import re
import time
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from . import avisos, ejemplos
from .corridas import Corridas, obtener_corridas
from .dominio import (HORIZONTE_SEMANAS, MIN_TIENDAS, MIN_TRANSACCIONES, MODELO, NIVELES_INTERVALO,
                      SEMANAS_RESERVADAS, ErrorDominio, periodo_estacional, regla_publicacion)
from .fuentes import Fuentes, obtener_fuentes
from .modelo import pronosticar
from .pagination import normalizar
from .publicacion import evaluar
from .roles import PERFILES_INTERNOS, ROL, requiere_roles
from .semanas import huella, serie_semanal, ventana
from .unidades import convertir

router = APIRouter(tags=["Pronóstico de demanda (D-40)"])

#: Ruta → raíz XML del XSD. `*` es un segmento (el id de la corrida).
RAICES_XML = {
    "/v1/forecast/run": "forecastRunResponse",
    "/v1/forecast/runs": "forecastRunListResponse",
    "/v1/forecast/runs/*": "forecastRunResponse",
    "/v1/forecast/runs/*/replay": "forecastReplayResponse",
}

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
#: Lo que `replay` compara exactamente, sin tolerancia (DF-9).
_COMPARADOS = ("validation", "forecast", "model")
_MAX_DIFERENCIAS = 50


def _uuid(valor: str | None, campo: str) -> str | None:
    if valor is not None and not _UUID.match(valor):
        raise ValueError(f"{campo} debe ser un UUID.")
    return valor.lower() if valor else valor


class CorridaDto(BaseModel):
    """Cuerpo de `POST /v1/forecast/run`. Horizonte, reservadas, intervalos y modelo los fija D-40."""
    model_config = ConfigDict(extra="forbid")

    productId: str
    zoneId: str | None = None
    dateFrom: str | None = None
    dateTo: str | None = None

    @field_validator("productId", "zoneId")
    @classmethod
    def _es_uuid(cls, valor, info):
        return _uuid(valor, info.field_name)

    @field_validator("dateFrom", "dateTo")
    @classmethod
    def _es_fecha(cls, valor, info):
        if valor is None:
            return valor
        if not _FECHA.match(valor):
            raise ValueError(f"{info.field_name} debe tener formato YYYY-MM-DD.")
        try:
            date.fromisoformat(valor)
        except ValueError:
            raise ValueError(f"{info.field_name} no es una fecha válida.") from None
        return valor

    @model_validator(mode="after")
    def _orden(self):
        if self.dateFrom and self.dateTo and self.dateFrom > self.dateTo:
            raise ValueError("dateFrom no puede ser posterior a dateTo.")
        return self


@router.post(
    "/v1/forecast/run",
    status_code=201,
    summary="Pronostica 8 semanas de demanda de un producto (y zona) y guarda la corrida. Solo Analista comercial.",
    description="Holt-Winters aditivo ETS(A,A,A), periodo de 4 semanas; validación con las últimas 4 (MAPE); "
                "intervalos 80 % y 95 %. Serie en la unidad base del producto (DF-2). Menos de 12 semanas → 422. "
                "Con menos de 10 transacciones o 3 tiendas la corrida sale `disponible: false` sin números "
                "(D-36). Se guarda en Mongo con la serie usada (D-47, D-15); si Mongo no responde → 503.",
    responses={
        201: ejemplos.respuesta("La corrida guardada (disponible o no).", ejemplos.CORRIDA,
                                RAICES_XML["/v1/forecast/run"]),
        **ejemplos.errores("/v1/forecast/run", 400, 401, 403, 404, 422, 503),
    },
)
def correr(
    cuerpo: Annotated[CorridaDto, Body(openapi_examples=ejemplos.CUERPOS_CORRIDA)],
    request: Request,
    tareas: BackgroundTasks,
    usuario: dict = Depends(requiere_roles(ROL.ANALISTA)),
    fuentes: Fuentes = Depends(obtener_fuentes),
    corridas: Corridas = Depends(obtener_corridas),
) -> dict:
    inicio = time.perf_counter()
    periodo, regla = periodo_estacional(), regla_publicacion()
    try:
        corrida = _calcular(cuerpo, usuario, fuentes, periodo, regla)
    except ErrorDominio as error:
        # 422: no se guarda ni se reporta (contrato, paso 6).
        raise HTTPException(error.status, error.mensaje) from error
    corrida["durationMs"] = round((time.perf_counter() - inicio) * 1000, 1)
    guardada = corridas.guardar(corrida)
    tareas.add_task(avisos.corrida_guardada, guardada, avisos.contexto(request))
    return guardada


def _calcular(cuerpo: CorridaDto, usuario: dict, fuentes: Fuentes, periodo: int, regla: str) -> dict:
    """Pasos 2 a 7 del contrato. Lanza `ErrorDominio` (422) o `HTTPException` (404/503)."""
    producto = fuentes.producto(cuerpo.productId)
    zona = fuentes.zona(cuerpo.zoneId) if cuerpo.zoneId else None
    presentaciones = fuentes.presentaciones(cuerpo.productId)

    desde, hasta = ventana(_fecha(cuerpo.dateFrom), _fecha(cuerpo.dateTo), datetime.now(timezone.utc))
    if desde is not None and desde > hasta:
        raise ErrorDominio(f"La ventana no contiene ninguna semana completa de lunes a domingo "
                           f"(del {desde.isoformat()} al {hasta.isoformat()}).")
    ventas = fuentes.ventas_semanales(cuerpo.productId, cuerpo.zoneId, desde, hasta)
    convertidas = convertir(ventas["data"], presentaciones)
    if convertidas["unit"] is None:
        raise ErrorDominio("El producto no tiene presentaciones con una unidad única: no se puede expresar la "
                           "demanda en kg, l o pza (DF-2).")

    disponible, motivo = evaluar(ventas["transactions"], ventas["stores"], regla, con_zona=zona is not None)
    corrida = {
        "userId": usuario["id"],
        "date": datetime.now(timezone.utc),
        "parameters": {
            "productId": cuerpo.productId, "zoneId": cuerpo.zoneId, "dateFrom": cuerpo.dateFrom,
            "dateTo": cuerpo.dateTo, "horizonWeeks": HORIZONTE_SEMANAS, "holdoutWeeks": SEMANAS_RESERVADAS,
            "seasonalPeriod": periodo, "intervalLevels": list(NIVELES_INTERVALO), "model": MODELO,
            "publicationRule": regla, "minTransactions": MIN_TRANSACCIONES, "minStores": MIN_TIENDAS,
        },
        "product": {**producto, "unit": convertidas["unit"], "unitType": convertidas["unitType"]},
        "zone": zona,
        "disponible": disponible,
        "motivo": motivo,
        # D-36: la cobertura sale aunque la corrida no esté disponible; ningún otro número.
        "coverage": {"transactions": ventas["transactions"], "stores": ventas["stores"]},
        "excludedPresentations": convertidas["excluded"],
        "limitations": [],
        "assumptions": list(ejemplos.SUPUESTOS),
    }
    if not disponible:
        return corrida

    serie = serie_semanal(convertidas["porSemana"], hasta)
    calculo = pronosticar(serie, periodo)  # DF-4/DF-5 → 422 antes de guardar
    corrida.update({
        "dataVersion": {
            "sha256": huella(serie), "source": "core-process-service", "asOf": ventas["asOf"],
            "weeks": len(serie), "effectiveFrom": serie[0]["weekStart"], "effectiveTo": hasta.isoformat(),
            "zeroWeeks": sum(1 for s in serie if s["filled"]),
        },
        "history": serie,
        **calculo,
    })
    if corrida["excludedPresentations"]:
        corrida["limitations"].append(
            f"{len(corrida['excludedPresentations'])} presentación(es) sin contenido conocido quedaron fuera de la "
            "serie (ver excludedPresentations).")
    return corrida


def _fecha(valor: str | None) -> date | None:
    return date.fromisoformat(valor) if valor else None


@router.get(
    "/v1/forecast/runs",
    summary="Historial de corridas de pronóstico, de la más reciente a la más antigua (paginado).",
    description="Resumen sin la serie ni el pronóstico. `weeks` y `mape` son nulos en una corrida no disponible.",
    responses={
        200: ejemplos.respuesta("Página de corridas.", ejemplos.LISTA, RAICES_XML["/v1/forecast/runs"]),
        **ejemplos.errores("/v1/forecast/runs", 400, 401, 403, 503,
                           mensajes={503: "MongoDB no responde: no se pudo leer las corridas."}),
    },
)
def listar(
    productId: Annotated[str | None, Query(description="UUID del producto.")] = None,
    zoneId: Annotated[str | None, Query(description="UUID de la zona.")] = None,
    page: Annotated[int | None, Query(description="Página, desde 1.")] = None,
    limit: Annotated[int | None, Query(description="Entre 1 y 100; default 20.")] = None,
    _usuario: dict = Depends(requiere_roles(*PERFILES_INTERNOS)),
    corridas: Corridas = Depends(obtener_corridas),
) -> dict:
    try:
        producto, zona = _uuid(productId, "productId"), _uuid(zoneId, "zoneId")
        pagina, tope = normalizar(page, limit)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    datos, total = corridas.listar(producto, zona, pagina, tope)
    return {"data": datos, "total": total, "page": pagina, "limit": tope}


@router.get(
    "/v1/forecast/runs/{id_corrida}",
    summary="Una corrida completa: parámetros, serie usada, validación, pronóstico y modelo.",
    responses={
        200: ejemplos.respuesta("La corrida.", ejemplos.CORRIDA, RAICES_XML["/v1/forecast/runs/*"]),
        **ejemplos.errores("/v1/forecast/runs/{id_corrida}", 400, 401, 403, 404, 503, mensajes={
            400: "'abc' no es un id de corrida (ObjectId de 24 caracteres hex).",
            404: "No existe la corrida de pronóstico 674a1f3c9e2b4d0012ab34cd.",
            503: "MongoDB no responde: no se pudo leer la corrida."}),
    },
)
def obtener(
    id_corrida: str,
    _usuario: dict = Depends(requiere_roles(*PERFILES_INTERNOS)),
    corridas: Corridas = Depends(obtener_corridas),
) -> dict:
    return corridas.obtener(id_corrida)


@router.post(
    "/v1/forecast/runs/{id_corrida}/replay",
    summary="Recalcula una corrida desde su foto y dice si salió idéntica (D-15). Solo Analista comercial.",
    description="Usa la serie y los parámetros guardados, sin pedir datos a core-process, y compara exactamente "
                "`validation`, `forecast` y `model`. No crea una corrida nueva. Una corrida no disponible → 409.",
    responses={
        200: ejemplos.respuesta("Resultado de la repetición.", ejemplos.REPETICION,
                                RAICES_XML["/v1/forecast/runs/*/replay"]),
        **ejemplos.errores("/v1/forecast/runs/{id_corrida}/replay", 400, 401, 403, 404, 409, 503),
    },
)
def repetir(
    id_corrida: str,
    request: Request,
    tareas: BackgroundTasks,
    _usuario: dict = Depends(requiere_roles(ROL.ANALISTA)),
    corridas: Corridas = Depends(obtener_corridas),
) -> dict:
    inicio = time.perf_counter()
    guardada = corridas.obtener(id_corrida)
    if not guardada.get("disponible"):
        raise HTTPException(409, "La corrida no está disponible (D-36): no tiene datos que recalcular.")
    serie = guardada["history"]
    try:
        recalculada = pronosticar(serie, guardada["parameters"]["seasonalPeriod"])
    except ErrorDominio as error:
        raise HTTPException(error.status, error.mensaje) from error

    diferencias = []
    sha = huella(serie)
    if sha != guardada["dataVersion"]["sha256"]:
        diferencias.append({"field": "dataVersion.sha256", "stored": guardada["dataVersion"]["sha256"],
                            "recomputed": sha})
    for campo in _COMPARADOS:
        diferencias += _diferencias(campo, guardada.get(campo), recalculada[campo])
    resultado = {"runId": guardada["id"], "identical": not diferencias, "sha256": guardada["dataVersion"]["sha256"],
                 "differences": diferencias[:_MAX_DIFERENCIAS],
                 "durationMs": round((time.perf_counter() - inicio) * 1000, 1)}
    tareas.add_task(avisos.repeticion, resultado, avisos.contexto(request))
    return resultado


def _diferencias(ruta: str, guardado, recalculado) -> list[dict]:
    """Comparación exacta, hoja por hoja (`forecast[3].lower95`), sin tolerancia."""
    if isinstance(guardado, dict) and isinstance(recalculado, dict):
        salida = []
        for clave in sorted(set(guardado) | set(recalculado)):
            salida += _diferencias(f"{ruta}.{clave}", guardado.get(clave), recalculado.get(clave))
        return salida
    if isinstance(guardado, list) and isinstance(recalculado, list) and len(guardado) == len(recalculado):
        salida = []
        for i, (a, b) in enumerate(zip(guardado, recalculado)):
            salida += _diferencias(f"{ruta}[{i}]", a, b)
        return salida
    if guardado == recalculado and type(guardado) is type(recalculado):
        return []
    return [{"field": ruta, "stored": json.dumps(guardado, ensure_ascii=False),
             "recomputed": json.dumps(recalculado, ensure_ascii=False)}]
