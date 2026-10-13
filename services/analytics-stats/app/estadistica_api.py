"""RF-20 a RF-22 — Rutas de las pruebas estadísticas.

Se calculan al vuelo y no se guardan. Solo el Analista comercial las
ejecuta (D-24). Las rutas solo traducen: el cálculo vive en `estadistica.py`.
Son `def` (no `async`): FastAPI las corre en un hilo aparte y el cálculo no
bloquea las demás peticiones.
"""
from fastapi import APIRouter, Depends, HTTPException

from . import ejemplos
from .esquemas import AnovaDto, PruebaHipotesisDto, ProporcionesDto
from .estadistica import Conteo, DatosInvalidos, Grupo, anova, comparar_proporciones, prueba_dos_grupos
from .roles import ROL, requiere_roles

router = APIRouter(tags=["Estadística (RF-20 a RF-22)"])

#: Ruta → raíz XML del XSD (`docs/contratos/analytics-stats.xsd`).
RAICES_XML = {
    "/v1/hypothesis/test": "hypothesisTestResponse",
    "/v1/anova": "anovaResponse",
    "/v1/proportions/compare": "proportionsResponse",
}

_SOLO_ANALISTA = Depends(requiere_roles(ROL.ANALISTA))


def _calcular(funcion, *argumentos) -> dict:
    try:
        resultado = funcion(*argumentos)
    except DatosInvalidos as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    # Con los valores en el cuerpo no hay fuente que describir.
    return {**resultado, "source": None}


@router.post(
    "/v1/hypothesis/test",
    summary="Prueba de hipótesis entre dos grupos (Welch o Mann-Whitney). Solo Analista comercial.",
    description="Welch por defecto; Mann-Whitney si se pide o si algún grupo tiene menos de 8 valores. "
                "Se calcula al vuelo y no se guarda.",
    responses={
        200: ejemplos.respuesta("Resultado de la prueba.", ejemplos.HIPOTESIS, RAICES_XML["/v1/hypothesis/test"]),
        **ejemplos.errores("/v1/hypothesis/test", 400, 401, 403, 503),
    },
)
def prueba_de_hipotesis(cuerpo: PruebaHipotesisDto, _usuario: dict = _SOLO_ANALISTA) -> dict:
    grupos = [Grupo(g.label, g.values) for g in cuerpo.groups]
    return _calcular(prueba_dos_grupos, grupos, cuerpo.method, cuerpo.alternative, cuerpo.alpha)


@router.post(
    "/v1/anova",
    summary="ANOVA de un factor entre grupos. Solo Analista comercial.",
    description="Con dos grupos se resuelve con la prueba de dos grupos de /v1/hypothesis/test; "
                "con uno responde 400. Se calcula al vuelo y no se guarda.",
    responses={
        200: ejemplos.respuesta("Resultado de ANOVA.", ejemplos.ANOVA, RAICES_XML["/v1/anova"]),
        **ejemplos.errores("/v1/anova", 400, 401, 403, 503),
    },
)
def analisis_de_varianza(cuerpo: AnovaDto, _usuario: dict = _SOLO_ANALISTA) -> dict:
    grupos = [Grupo(g.label, g.values) for g in cuerpo.groups]
    return _calcular(anova, grupos, cuerpo.alpha)


@router.post(
    "/v1/proportions/compare",
    summary="Comparación de proporciones entre grupos (z, Fisher o χ²). Solo Analista comercial.",
    description="Dos grupos: z de dos proporciones, o Fisher si algún conteo esperado es menor a 5. "
                "Tres o más: χ² de homogeneidad. Se calcula al vuelo y no se guarda.",
    responses={
        200: ejemplos.respuesta("Resultado de la comparación.", ejemplos.PROPORCIONES,
                                RAICES_XML["/v1/proportions/compare"]),
        **ejemplos.errores("/v1/proportions/compare", 400, 401, 403, 503),
    },
)
def comparacion_de_proporciones(cuerpo: ProporcionesDto, _usuario: dict = _SOLO_ANALISTA) -> dict:
    conteos = [Conteo(g.label, g.successes, g.total) for g in cuerpo.groups]
    return _calcular(comparar_proporciones, conteos, cuerpo.alpha)
