"""RF-16 — Rutas del clustering de zonas.

Correr es del Analista comercial; las corridas guardadas las leen los 6
perfiles internos (D-24). Cada corrida se guarda en Mongo con su entrada (D3,
D-15) y solo el `userId` (D-26). La corrida propone grupos: no cambia la
clasificación de las zonas, que sigue siendo manual en catalog.
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Request

from . import ejemplos, reportes
from .clustering import agrupar_zonas
from .corridas import Corridas, obtener_corridas
from .esquemas import ClusteringDto
from .estadistica import DatosInvalidos
from .fuentes import Fuentes, obtener_fuentes
from .pagination import normalizar
from .roles import PERFILES_INTERNOS, ROL, requiere_roles

router = APIRouter(tags=["Clustering de zonas (RF-16)"])

#: Ruta → raíz XML del XSD. `*` cubre `/v1/clustering/runs/:id`.
RAICES_XML = {
    "/v1/clustering/run": "clusteringRunResponse",
    "/v1/clustering/runs": "clusteringRunListResponse",
    "/v1/clustering/runs/*": "clusteringRunResponse",
}

_404 = {404: "No existe la corrida de clustering 6713f0c2e4b0a1b2c3d4e5f6."}
_503 = {503: "MongoDB no responde: no se pudo guardar la corrida."}


@router.post(
    "/v1/clustering/run",
    status_code=201,
    summary="Agrupa zonas con KMeans y guarda la corrida. Solo Analista comercial.",
    description="Indicadores estandarizados (z-score), `k` y semilla fija. Sin `zones`, los indicadores salen de "
                "catalog y el ticket de core-process. Una zona sin datos no se rellena con 0: va a "
                "`excludedZones`. `k` debe ser menor al número de zonas con datos (D-27). La corrida se guarda "
                "completa en Mongo (D3); si Mongo no responde → 503 (D-25).",
    responses={
        201: ejemplos.respuesta("La corrida guardada.", ejemplos.CLUSTERING, RAICES_XML["/v1/clustering/run"]),
        **ejemplos.errores("/v1/clustering/run", 400, 401, 403, 404, 503, mensajes={
            400: "k debe ser menor que el número de zonas con datos (3): con estos datos solo se puede k = 2 (D-27).",
            404: "Alguna zona de zoneIds no existe en catalog-service.", **_503}),
    },
)
def correr_clustering(
    cuerpo: Annotated[ClusteringDto, Body(openapi_examples=ejemplos.CUERPOS_CLUSTERING)],
    request: Request,
    tareas: BackgroundTasks,
    usuario: dict = Depends(requiere_roles(ROL.ANALISTA)),
    fuentes: Fuentes = Depends(obtener_fuentes),
    corridas: Corridas = Depends(obtener_corridas),
) -> dict:
    try:
        if cuerpo.zones is not None:
            entrada, origen = [z.model_dump() for z in cuerpo.zones], "cuerpo"
        else:
            entrada, origen = _entrada_de_servicios(fuentes, cuerpo), "servicios"
        resultado = agrupar_zonas(entrada, cuerpo.k, cuerpo.seed, cuerpo.features)
    except DatosInvalidos as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    guardada = corridas.guardar({
        "userId": usuario["id"],
        "date": datetime.now(timezone.utc),
        "parameters": {
            "k": cuerpo.k,
            "seed": cuerpo.seed,
            "features": cuerpo.features,
            "source": origen,
            "zoneIds": [str(z) for z in cuerpo.zoneIds] if cuerpo.zoneIds else None,
            "dateFrom": cuerpo.dateFrom,
            "dateTo": cuerpo.dateTo,
        },
        # La foto de D-15: con esta entrada y la semilla se repiten las asignaciones.
        "input": entrada,
        **resultado,
    })
    # Bitácora y aviso de fondo, ya con la corrida guardada (STA-04). Si Mongo no
    # respondió no hay corrida y no se llega aquí: no se reporta.
    tareas.add_task(reportes.clustering_terminado, guardada, *reportes.contexto(request))
    return guardada


def _entrada_de_servicios(fuentes: Fuentes, cuerpo: ClusteringDto) -> list[dict]:
    zonas = fuentes.zonas([str(z) for z in cuerpo.zoneIds] if cuerpo.zoneIds else None)
    if "averageTicket" in cuerpo.features:
        for zona in zonas:
            zona["averageTicket"] = fuentes.ticket_promedio(zona["zoneId"], cuerpo.dateFrom, cuerpo.dateTo)
    return zonas


@router.get(
    "/v1/clustering/runs",
    summary="Historial de corridas de clustering, de la más reciente a la más antigua (paginado).",
    description="Sin la entrada ni las asignaciones; `zoneCount` dice cuántas zonas se agruparon.",
    responses={
        200: ejemplos.respuesta("Página de corridas.", ejemplos.LISTA_CORRIDAS, RAICES_XML["/v1/clustering/runs"]),
        **ejemplos.errores("/v1/clustering/runs", 400, 401, 403, 503,
                           mensajes={503: "MongoDB no responde: no se pudo leer las corridas."}),
    },
)
def listar_corridas(
    page: Annotated[int | None, Query(description="Página, desde 1.")] = None,
    limit: Annotated[int | None, Query(description="Entre 1 y 100; default 20.")] = None,
    _usuario: dict = Depends(requiere_roles(*PERFILES_INTERNOS)),
    corridas: Corridas = Depends(obtener_corridas),
) -> dict:
    try:
        pagina, tope = normalizar(page, limit)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    datos, total = corridas.listar(pagina, tope)
    return {"data": datos, "total": total, "page": pagina, "limit": tope}


@router.get(
    "/v1/clustering/runs/{id_corrida}",
    summary="Una corrida de clustering completa: parámetros, entrada, grupos y asignaciones.",
    responses={
        200: ejemplos.respuesta("La corrida.", ejemplos.CLUSTERING, RAICES_XML["/v1/clustering/runs/*"]),
        **ejemplos.errores("/v1/clustering/runs/{id_corrida}", 400, 401, 403, 404, 503, mensajes={
            400: "'abc' no es un id de corrida (ObjectId de 24 caracteres hex).", **_404,
            503: "MongoDB no responde: no se pudo leer la corrida."}),
    },
)
def obtener_corrida(
    id_corrida: str,
    _usuario: dict = Depends(requiere_roles(*PERFILES_INTERNOS)),
    corridas: Corridas = Depends(obtener_corridas),
) -> dict:
    return corridas.obtener(id_corrida)
