"""Cuerpos de las pruebas estadísticas (contrato analytics-stats).

pydantic valida tipos y rangos; las reglas de negocio (grupos, mínimos,
variación) las valida `estadistica.py` con mensajes en español. Cualquier
error de aquí es 400 VALIDATION_ERROR.
"""
from typing import Annotated, Literal

from pydantic import AllowInfNan, BaseModel, ConfigDict, Field, Strict, StringConstraints

#: Número finito y de verdad numérico: "5", true, NaN o Infinity → 400.
Numero = Annotated[float, Strict(), AllowInfNan(False)]
Entero = Annotated[int, Strict()]
Etiqueta = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Alpha = Annotated[float, Field(gt=0, lt=1, description="Nivel de significancia.")]


class _Cuerpo(BaseModel):
    # Como `forbidNonWhitelisted` en Nest: un campo que no está en el contrato es 400.
    model_config = ConfigDict(extra="forbid")


class GrupoValores(_Cuerpo):
    label: Etiqueta
    values: list[Numero]


class GrupoConteo(_Cuerpo):
    label: Etiqueta
    successes: Annotated[Entero, Field(ge=0)]
    total: Entero


class PruebaHipotesisDto(_Cuerpo):
    groups: list[GrupoValores]
    method: Literal["auto", "welch", "mannwhitney"] = "auto"
    alternative: Literal["two-sided", "greater", "less"] = "two-sided"
    alpha: Alpha = 0.05


class AnovaDto(_Cuerpo):
    groups: list[GrupoValores]
    alpha: Alpha = 0.05


class ProporcionesDto(_Cuerpo):
    groups: list[GrupoConteo]
    alpha: Alpha = 0.05
