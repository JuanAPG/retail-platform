"""RF-20 a RF-22 — Rutas de las pruebas estadísticas.

Se calculan al vuelo y no se guardan. Solo el Analista comercial las
ejecuta (D-24). Los datos llegan en `groups` o se piden a core-process con
`baskets` (`fuentes.py`); el cálculo vive en `estadistica.py`.
Son `def` (no `async`): FastAPI las corre en un hilo aparte y ni el cálculo ni
las llamadas HTTP bloquean las demás peticiones.
"""
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Request

from . import ejemplos, reportes
from .esquemas import AnovaDto, FuenteCanastas, PruebaHipotesisDto, ProporcionesDto
from .estadistica import Conteo, DatosInvalidos, Grupo, anova, comparar_proporciones, prueba_dos_grupos
from .fuentes import QUE_CONDICION, QUE_METRICA, Fuentes, obtener_fuentes
from .roles import ROL, requiere_roles

router = APIRouter(tags=["Estadística (RF-20 a RF-22)"])

#: Ruta → raíz XML del XSD (`docs/contratos/analytics-stats.xsd`).
RAICES_XML = {
    "/v1/hypothesis/test": "hypothesisTestResponse",
    "/v1/anova": "anovaResponse",
    "/v1/proportions/compare": "proportionsResponse",
}

_SOLO_ANALISTA = Depends(requiere_roles(ROL.ANALISTA))
_FUENTES = Depends(obtener_fuentes)


def _datos(leer, *argumentos):
    """Lo que lee de otros servicios; el tope de D-27 es un 400, no un 500."""
    try:
        return leer(*argumentos)
    except DatosInvalidos as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def _calcular(funcion, *argumentos, fuente: FuenteCanastas | None) -> dict:
    try:
        resultado = funcion(*argumentos)
    except DatosInvalidos as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    # `source` repite lo pedido en `baskets`; null si los valores vinieron en el cuerpo.
    return {**resultado, "source": fuente.model_dump(mode="json") if fuente else None}


def _reportar(tareas: BackgroundTasks, request: Request, tipo: str, resultado: dict) -> dict:
    """Bitácora de la prueba, de fondo: la respuesta sale primero (STA-04)."""
    tareas.add_task(reportes.prueba_terminada, tipo, resultado, *reportes.contexto(request))
    return resultado


def _valores(cuerpo, fuentes: Fuentes) -> tuple[list[Grupo], str | None]:
    if cuerpo.baskets:
        return _datos(fuentes.valores, cuerpo.baskets), QUE_METRICA[cuerpo.baskets.metric]
    return [Grupo(g.label, g.values) for g in cuerpo.groups], None


@router.post(
    "/v1/hypothesis/test",
    summary="Prueba de hipótesis entre dos grupos (Welch o Mann-Whitney). Solo Analista comercial.",
    description="Welch por defecto; Mann-Whitney si se pide o si algún grupo tiene menos de 8 valores. "
                "Los valores llegan en `groups` o salen de las canastas con `baskets`. "
                "Se calcula al vuelo y no se guarda.",
    responses={
        200: ejemplos.respuesta("Resultado de la prueba.", ejemplos.HIPOTESIS, RAICES_XML["/v1/hypothesis/test"]),
        **ejemplos.errores("/v1/hypothesis/test", 400, 401, 403, 404, 503),
    },
)
def prueba_de_hipotesis(
    cuerpo: Annotated[PruebaHipotesisDto, Body(openapi_examples=ejemplos.CUERPOS_HIPOTESIS)],
    request: Request,
    tareas: BackgroundTasks,
    _usuario: dict = _SOLO_ANALISTA,
    fuentes: Fuentes = _FUENTES,
) -> dict:
    grupos, que = _valores(cuerpo, fuentes)
    resultado = _calcular(prueba_dos_grupos, grupos, cuerpo.method, cuerpo.alternative, cuerpo.alpha, que,
                          fuente=cuerpo.baskets)
    return _reportar(tareas, request, "hipotesis", resultado)


@router.post(
    "/v1/anova",
    summary="ANOVA de un factor entre grupos. Solo Analista comercial.",
    description="Con dos grupos se resuelve con la prueba de dos grupos de /v1/hypothesis/test; "
                "con uno responde 400. Se calcula al vuelo y no se guarda.",
    responses={
        200: ejemplos.respuesta("Resultado de ANOVA.", ejemplos.ANOVA, RAICES_XML["/v1/anova"]),
        **ejemplos.errores("/v1/anova", 400, 401, 403, 404, 503),
    },
)
def analisis_de_varianza(
    cuerpo: Annotated[AnovaDto, Body(openapi_examples=ejemplos.CUERPOS_ANOVA)],
    request: Request,
    tareas: BackgroundTasks,
    _usuario: dict = _SOLO_ANALISTA,
    fuentes: Fuentes = _FUENTES,
) -> dict:
    grupos, que = _valores(cuerpo, fuentes)
    resultado = _calcular(anova, grupos, cuerpo.alpha, que, fuente=cuerpo.baskets)
    return _reportar(tareas, request, "anova", resultado)


@router.post(
    "/v1/proportions/compare",
    summary="Comparación de proporciones entre grupos (z, Fisher o χ²). Solo Analista comercial.",
    description="Dos grupos: z de dos proporciones, o Fisher si algún conteo esperado es menor a 5. "
                "Tres o más: χ² de homogeneidad. Con `baskets`, cuenta las canastas que cumplen "
                "`condition`. Se calcula al vuelo y no se guarda.",
    responses={
        200: ejemplos.respuesta("Resultado de la comparación.", ejemplos.PROPORCIONES,
                                RAICES_XML["/v1/proportions/compare"]),
        **ejemplos.errores("/v1/proportions/compare", 400, 401, 403, 404, 503),
    },
)
def comparacion_de_proporciones(
    cuerpo: Annotated[ProporcionesDto, Body(openapi_examples=ejemplos.CUERPOS_PROPORCIONES)],
    request: Request,
    tareas: BackgroundTasks,
    _usuario: dict = _SOLO_ANALISTA,
    fuentes: Fuentes = _FUENTES,
) -> dict:
    if cuerpo.baskets:
        conteos, que = _datos(fuentes.conteos, cuerpo.baskets), QUE_CONDICION[cuerpo.baskets.condition]
    else:
        conteos, que = [Conteo(g.label, g.successes, g.total) for g in cuerpo.groups], None
    resultado = _calcular(comparar_proporciones, conteos, cuerpo.alpha, que, fuente=cuerpo.baskets)
    return _reportar(tareas, request, "proporciones", resultado)
