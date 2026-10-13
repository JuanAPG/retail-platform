"""Cuerpos de las pruebas estadísticas (contrato analytics-stats).

pydantic valida tipos, rangos y la forma de la petición; las reglas de los
datos (mínimos, variación, conteos) las valida `estadistica.py` con mensajes en
español. Cualquier error de aquí es 400 VALIDATION_ERROR.
"""
import re
from datetime import date
from typing import Annotated, ClassVar, Literal
from uuid import UUID

from pydantic import AllowInfNan, BaseModel, ConfigDict, Field, Strict, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

#: Número finito y de verdad numérico: "5", true, NaN o Infinity → 400.
Numero = Annotated[float, Strict(), AllowInfNan(False)]
Entero = Annotated[int, Strict()]
Etiqueta = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Alpha = Annotated[float, Field(gt=0, lt=1, description="Nivel de significancia.")]

#: `segmentos_ingreso.id` es SMALLINT: un id mayor no existe.
_SEGMENTO = re.compile(r"^[1-9]\d{0,4}$")
_SEGMENTO_MAX = 32767
MAX_GRUPOS = 20


def _invalido(mensaje: str) -> PydanticCustomError:
    # PydanticCustomError deja el mensaje tal cual (un ValueError le antepone "Value error, ").
    return PydanticCustomError("cuerpo_invalido", mensaje)


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


class FuenteCanastas(_Cuerpo):
    """Modo `baskets`: los valores salen de `GET /v1/baskets` de core-process."""

    metric: Literal["totalValue", "productCount", "unitsTotal"] | None = None
    condition: Literal["hasBasicProducts", "chica", "mediana", "grande"] | None = None
    groupBy: Literal["segment", "zone"]
    groupIds: list[str]
    dateFrom: str | None = None
    dateTo: str | None = None
    storeId: UUID | None = None

    @model_validator(mode="after")
    def _coherente(self):
        if len(set(self.groupIds)) != len(self.groupIds):
            raise _invalido("groupIds no puede repetir ids.")
        for gid in self.groupIds:
            if self.groupBy == "segment" and not (_SEGMENTO.match(gid) and int(gid) <= _SEGMENTO_MAX):
                raise _invalido(f"'{gid}' no es un id de segmento (entero de 1 a {_SEGMENTO_MAX}).")
            if self.groupBy == "zone" and not _es_uuid(gid):
                raise _invalido(f"'{gid}' no es un id de zona (UUID).")
        _validar_dias(self)
        return self


def _validar_dias(modelo) -> None:
    """`dateFrom`/`dateTo`: día YYYY-MM-DD que exista, y en orden."""
    dias = {}
    for campo in ("dateFrom", "dateTo"):
        valor = getattr(modelo, campo)
        if valor is None:
            continue
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor):
                raise ValueError
            dias[campo] = date.fromisoformat(valor)
        except ValueError:
            raise _invalido(f"{campo} debe ser un día YYYY-MM-DD que exista.") from None
    if len(dias) == 2 and dias["dateTo"] < dias["dateFrom"]:
        raise _invalido("La fecha final no puede ser anterior a la inicial.")


def _es_uuid(texto: str) -> bool:
    try:
        UUID(texto)
    except ValueError:
        return False
    return True


class _ConFuente(_Cuerpo):
    """Exactamente uno de `groups` (valores en el cuerpo) o `baskets`."""

    #: Cuántos grupos acepta la prueba con `baskets` (con `groups` lo valida el cálculo).
    GRUPOS: ClassVar[tuple[int, int]] = (2, MAX_GRUPOS)
    #: Qué pide de `baskets`: `metric` (valores) o `condition` (conteos).
    USA: ClassVar[str] = "metric"

    @model_validator(mode="after")
    def _un_origen(self):
        if (self.groups is None) == (self.baskets is None):
            raise _invalido("Manda los datos en `groups` o pide `baskets`: exactamente uno de los dos.")
        if self.baskets is not None:
            fuente, usa = self.baskets, self.USA
            otro = "condition" if usa == "metric" else "metric"
            if getattr(fuente, usa) is None:
                raise _invalido(f"Con `baskets`, esta prueba necesita `{usa}`.")
            if getattr(fuente, otro) is not None:
                raise _invalido(f"`{otro}` no aplica a esta prueba; usa `{usa}`.")
            minimo, maximo = self.GRUPOS
            if not minimo <= len(fuente.groupIds) <= maximo:
                rango = f"exactamente {minimo}" if minimo == maximo else f"de {minimo} a {maximo}"
                raise _invalido(f"Esta prueba compara {rango} grupos; llegaron {len(fuente.groupIds)}.")
        return self


class PruebaHipotesisDto(_ConFuente):
    GRUPOS = (2, 2)
    groups: list[GrupoValores] | None = None
    baskets: FuenteCanastas | None = None
    method: Literal["auto", "welch", "mannwhitney"] = "auto"
    alternative: Literal["two-sided", "greater", "less"] = "two-sided"
    alpha: Alpha = 0.05


class AnovaDto(_ConFuente):
    groups: list[GrupoValores] | None = None
    baskets: FuenteCanastas | None = None
    alpha: Alpha = 0.05


class ProporcionesDto(_ConFuente):
    USA = "condition"
    groups: list[GrupoConteo] | None = None
    baskets: FuenteCanastas | None = None
    alpha: Alpha = 0.05


# --- Clustering (RF-16) -------------------------------------------------------

Variable = Literal["estimatedIncome", "population", "availability", "averageTicket"]
VARIABLES_POR_DEFECTO = ["estimatedIncome", "population", "availability", "averageTicket"]


class ZonaEnCuerpo(_Cuerpo):
    """Una zona con sus indicadores, cuando los datos llegan en el cuerpo."""

    zoneId: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    zoneName: Etiqueta | None = None
    estimatedIncome: Numero | None = None
    population: Numero | None = None
    availability: Numero | None = None
    averageTicket: Numero | None = None


class ClusteringDto(_Cuerpo):
    k: Annotated[Entero, Field(ge=2, le=10)]
    # sklearn exige una semilla menor a 2^32.
    seed: Annotated[Entero, Field(ge=0, le=2**32 - 1)] = 42
    features: list[Variable] = Field(default_factory=lambda: list(VARIABLES_POR_DEFECTO))
    zoneIds: list[UUID] | None = None
    dateFrom: str | None = None
    dateTo: str | None = None
    zones: list[ZonaEnCuerpo] | None = None

    @model_validator(mode="after")
    def _coherente(self):
        if not 1 <= len(self.features) <= len(VARIABLES_POR_DEFECTO) or len(set(self.features)) != len(self.features):
            raise _invalido("features lleva de 1 a 4 variables, sin repetir.")
        if self.zones is not None:
            if self.zoneIds is not None or self.dateFrom or self.dateTo:
                raise _invalido("Con `zones` (datos en el cuerpo) no van zoneIds ni fechas.")
            ids = [z.zoneId for z in self.zones]
            if len(set(ids)) != len(ids):
                raise _invalido("zones no puede repetir zoneId.")
        if self.zoneIds is not None:
            if len(set(self.zoneIds)) != len(self.zoneIds):
                raise _invalido("zoneIds no puede repetir ids.")
            if len(self.zoneIds) < 3:
                raise _invalido(f"Para agrupar hacen falta al menos 3 zonas; llegaron {len(self.zoneIds)}.")
        _validar_dias(self)
        return self
