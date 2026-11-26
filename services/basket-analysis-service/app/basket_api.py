"""Rutas de basket-analysis-service (contrato `basket-analysis-service.md`, D-37).

Todas son consultas de los 6 perfiles internos (Matriz §3.2: lectura de M07). Proveedor e
Investigador de mercado → 403. No guardan nada ni mandan bitácora, aviso o linaje (contrato).
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from . import ejemplos
from .comparacion import comparar
from .dominio import MIN_TIENDAS, MIN_TRANSACCIONES, UMBRAL_TIPICO, ErrorDominio, regla_publicacion
from .fuentes import Fuentes, obtener_fuentes
from .periodos import periodos, semanas, versiones_en_periodo
from .publicacion import evaluar
from .roles import PERFILES_INTERNOS, requiere_roles
from .tipica import huella, productos, resumen, tamano_tipico

router = APIRouter(tags=["Canasta típica (D-37)"])

RAICES_XML = {
    "/v1/typical-basket": "typicalBasketResponse",
    "/v1/typical-basket/compare": "basketComparisonResponse",
    "/v1/basket-evolution": "basketEvolutionResponse",
    "/v1/category-mix": "categoryMixResponse",
}

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_COMUNES = {"zoneId", "segmentId", "dateFrom", "dateTo", "asOf"}
_FUENTE = "core-process-service"
_SIN_FECHAS = "Sin dateFrom y dateTo, las semanas de basketsPerWeek van de la primera a la última semana con canastas del grupo."

ZonaId = Annotated[str, Query(description="UUID de la zona (obligatorio).")]
SegmentoId = Annotated[int, Query(ge=1, description="Id del segmento congelado en la canasta (obligatorio).")]
Fecha = Annotated[str | None, Query(description="YYYY-MM-DD, día local de Monterrey, inclusivo.")]
AsOf = Annotated[str | None, Query(description="Instante ISO 8601: solo ventas registradas hasta ahí (BA-8).")]
_LECTORES = Depends(requiere_roles(*PERFILES_INTERNOS))


# --- Validación de la consulta (todo error es 400)

def _solo(request: Request, permitidos: set[str]) -> None:
    """Cualquier otro parámetro → 400 (FastAPI los ignora por defecto)."""
    sobran = sorted(set(request.query_params) - permitidos)
    if sobran:
        raise HTTPException(400, f"Parámetro desconocido: {', '.join(sobran)}.")


def _uuid(valor: str) -> str:
    if not _UUID.match(valor):
        raise HTTPException(400, "zoneId debe ser un UUID.")
    return valor.lower()


def _fecha(valor: str | None, campo: str) -> date | None:
    if valor is None:
        return None
    try:
        if not _FECHA.match(valor):
            raise ValueError
        return date.fromisoformat(valor)
    except ValueError:
        raise HTTPException(400, f"{campo} debe ser una fecha YYYY-MM-DD válida.") from None


def _rango(desde: date | None, hasta: date | None, nombres=("dateFrom", "dateTo")) -> None:
    if desde and hasta and desde > hasta:
        raise HTTPException(400, f"{nombres[0]} no puede ser posterior a {nombres[1]}.")


def _as_of(valor: str | None) -> str | None:
    if valor is None:
        return None
    try:
        instante = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "asOf debe ser un instante ISO 8601.") from None
    if instante.tzinfo is None:
        raise HTTPException(400, "asOf debe llevar zona horaria (p. ej. Z o -06:00).")
    return valor


def _grupo(fuentes: Fuentes, zona_id: str, segmento_id: int, desde: date | None, hasta: date | None) -> dict:
    """Zona (404), segmento (404) y versiones del segmento en el periodo (BA-6, D-35)."""
    zona = fuentes.zona(zona_id)
    segmento = fuentes.segmento(segmento_id)
    versiones = versiones_en_periodo(fuentes.historial(zona_id), segmento_id, desde, hasta)
    return {"zone": zona, "segment": {**segmento, "versions": versiones}}


def _publicacion_base(regla: str) -> dict:
    return {"threshold": UMBRAL_TIPICO, "publicationRule": regla, "minTransactions": MIN_TRANSACCIONES,
            "minStores": MIN_TIENDAS}


# --- GET /v1/typical-basket

@router.get(
    "/v1/typical-basket",
    summary="Canasta típica de un grupo zona + segmento: productos en al menos el 20 % de sus canastas (D-37).",
    description="Frecuencia y gasto promedio por producto; un producto cuenta una vez por canasta (BA-2). Con "
                "menos de 10 transacciones o 3 tiendas el grupo no se publica (D-36): `disponible: false` sin "
                "números. `includeAll=true` también lista los que no alcanzan el 20 %.",
    responses={
        200: ejemplos.respuesta("La canasta típica del grupo (disponible o no).", ejemplos.TIPICA,
                                RAICES_XML["/v1/typical-basket"]),
        **ejemplos.errores("/v1/typical-basket", 400, 401, 403, 404, 503),
    },
)
def canasta_tipica(
    request: Request,
    zoneId: ZonaId,
    segmentId: SegmentoId,
    dateFrom: Fecha = None,
    dateTo: Fecha = None,
    asOf: AsOf = None,
    includeAll: Annotated[bool, Query(description="También los productos que no son típicos.")] = False,
    _usuario: dict = _LECTORES,
    fuentes: Fuentes = Depends(obtener_fuentes),
) -> dict:
    _solo(request, _COMUNES | {"includeAll"})
    zona_id, desde, hasta = _uuid(zoneId), _fecha(dateFrom, "dateFrom"), _fecha(dateTo, "dateTo")
    _rango(desde, hasta)
    regla = regla_publicacion()
    grupo = _grupo(fuentes, zona_id, segmentId, desde, hasta)
    datos = fuentes.canastas_por_producto(zona_id, segmentId, desde, hasta, _as_of(asOf))
    periodo = datos["periods"][0] if datos["periods"] else {"baskets": 0, "stores": 0, "totalSpend": 0}
    disponible, motivo = evaluar(periodo["baskets"], periodo["stores"], regla)

    respuesta = {
        "group": grupo,
        "period": {"dateFrom": dateFrom, "dateTo": dateTo},
        "asOf": datos["asOf"],
        **_publicacion_base(regla),
        "coverage": {"baskets": periodo["baskets"], "stores": periodo["stores"]},
        "disponible": disponible,
        "motivo": motivo,
        "summary": None, "products": None, "typicalSize": None, "dataVersion": None,
        "assumptions": [],
    }
    if not disponible:
        return respuesta  # D-36: ningún número del agregado

    supuestos = list(ejemplos.SUPUESTOS)
    if desde is None or hasta is None:
        desde, hasta = _semanas_con_canastas(fuentes, zona_id, segmentId, desde, hasta, datos["asOf"])
        supuestos.append(_SIN_FECHAS)
    respuesta.update({
        "summary": resumen(periodo, datos["data"], semanas(desde, hasta)),
        "products": productos(periodo, datos["data"], fuentes.categorias(), includeAll),
        "typicalSize": tamano_tipico(periodo, datos["data"]),
        "dataVersion": {"sha256": huella(datos["periods"], datos["data"]), "source": _FUENTE, "asOf": datos["asOf"]},
        "assumptions": supuestos,
    })
    return respuesta


def _semanas_con_canastas(fuentes: Fuentes, zona_id: str, segmento_id: int, desde: date | None,
                          hasta: date | None, as_of: str) -> tuple[date, date]:
    """Sin fechas: de la primera a la última semana con canastas, en la misma instantánea."""
    semanal = fuentes.canastas_por_producto(zona_id, segmento_id, desde, hasta, as_of, "week")
    lunes = sorted(date.fromisoformat(p["periodStart"]) for p in semanal["periods"] if p["baskets"] > 0)
    return desde or lunes[0], hasta or lunes[-1] + timedelta(days=6)


# --- GET /v1/typical-basket/compare

@router.get(
    "/v1/typical-basket/compare",
    summary="Compara la canasta típica del mismo grupo en dos periodos: qué entra, qué sale y qué sigue.",
    description="Los cuatro límites de periodo son obligatorios. Si cualquiera de los dos periodos no se puede "
                "publicar (D-36), la comparación sale `disponible: false` sin listas ni indicadores.",
    responses={
        200: ejemplos.respuesta("La comparación.", ejemplos.COMPARACION, RAICES_XML["/v1/typical-basket/compare"]),
        **ejemplos.errores("/v1/typical-basket/compare", 400, 401, 403, 404, 503),
    },
)
def comparar_periodos(
    request: Request,
    zoneId: ZonaId,
    segmentId: SegmentoId,
    periodAFrom: Annotated[str, Query(description="Inicio del periodo A, YYYY-MM-DD.")],
    periodATo: Annotated[str, Query(description="Fin del periodo A.")],
    periodBFrom: Annotated[str, Query(description="Inicio del periodo B.")],
    periodBTo: Annotated[str, Query(description="Fin del periodo B.")],
    asOf: AsOf = None,
    _usuario: dict = _LECTORES,
    fuentes: Fuentes = Depends(obtener_fuentes),
) -> dict:
    _solo(request, {"zoneId", "segmentId", "periodAFrom", "periodATo", "periodBFrom", "periodBTo", "asOf"})
    zona_id = _uuid(zoneId)
    a_desde, a_hasta = _fecha(periodAFrom, "periodAFrom"), _fecha(periodATo, "periodATo")
    b_desde, b_hasta = _fecha(periodBFrom, "periodBFrom"), _fecha(periodBTo, "periodBTo")
    _rango(a_desde, a_hasta, ("periodAFrom", "periodATo"))
    _rango(b_desde, b_hasta, ("periodBFrom", "periodBTo"))
    regla = regla_publicacion()
    grupo = _grupo(fuentes, zona_id, segmentId, min(a_desde, b_desde), max(a_hasta, b_hasta))

    datos_a = fuentes.canastas_por_producto(zona_id, segmentId, a_desde, a_hasta, _as_of(asOf))
    # Misma instantánea para los dos periodos (D-15): B usa el `asOf` que fijó A.
    datos_b = fuentes.canastas_por_producto(zona_id, segmentId, b_desde, b_hasta, datos_a["asOf"])
    lados = {}
    for nombre, datos, desde, hasta in (("A", datos_a, periodAFrom, periodATo), ("B", datos_b, periodBFrom, periodBTo)):
        periodo = datos["periods"][0] if datos["periods"] else {"baskets": 0, "stores": 0, "totalSpend": 0}
        disponible, motivo = evaluar(periodo["baskets"], periodo["stores"], regla)
        lados[nombre] = {"periodo": periodo, "filas": datos["data"],
                         "salida": {"dateFrom": desde, "dateTo": hasta, "disponible": disponible, "motivo": motivo,
                                    "coverage": {"baskets": periodo["baskets"], "stores": periodo["stores"]}}}

    respuesta = {"group": grupo, "asOf": datos_a["asOf"], "threshold": UMBRAL_TIPICO, "publicationRule": regla,
                 "periodA": lados["A"]["salida"], "periodB": lados["B"]["salida"]}
    fallan = [f"Periodo {n}: {lados[n]['salida']['motivo']}" for n in ("A", "B") if not lados[n]["salida"]["disponible"]]
    if fallan:
        return {**respuesta, "disponible": False, "motivo": " ".join(fallan),
                "entering": None, "leaving": None, "staying": None, "indicators": None}

    categorias = fuentes.categorias()
    calculo = {}
    for n in ("A", "B"):
        lado = lados[n]
        desde = date.fromisoformat(lado["salida"]["dateFrom"])
        hasta = date.fromisoformat(lado["salida"]["dateTo"])
        calculo[n] = (productos(lado["periodo"], lado["filas"], categorias, incluir_todo=True),
                      resumen(lado["periodo"], lado["filas"], semanas(desde, hasta)))
    return {**respuesta, "disponible": True, "motivo": None,
            **comparar(calculo["A"][0], calculo["B"][0], calculo["A"][1], calculo["B"][1])}


# --- GET /v1/basket-evolution

@router.get(
    "/v1/basket-evolution",
    summary="Serie del grupo por semana o mes: ticket, productos por canasta y tamaño de la canasta típica.",
    description="Semanas de lunes a domingo y meses calendario, en hora de Monterrey; el primer y el último "
                "periodo pueden quedar parciales. Cada periodo con su propia publicación (D-36). Sin huecos: un "
                "periodo sin canastas sale con cobertura 0 y `disponible: false`. Máximo 104 semanas o 36 meses.",
    responses={
        200: ejemplos.respuesta("La serie.", ejemplos.EVOLUCION, RAICES_XML["/v1/basket-evolution"]),
        **ejemplos.errores("/v1/basket-evolution", 400, 401, 403, 404, 503),
    },
)
def evolucion(
    request: Request,
    zoneId: ZonaId,
    segmentId: SegmentoId,
    dateFrom: Annotated[str, Query(description="YYYY-MM-DD (obligatorio).")],
    dateTo: Annotated[str, Query(description="YYYY-MM-DD (obligatorio).")],
    granularity: Annotated[Literal["week", "month"], Query(description="week o month.")] = "month",
    asOf: AsOf = None,
    _usuario: dict = _LECTORES,
    fuentes: Fuentes = Depends(obtener_fuentes),
) -> dict:
    _solo(request, _COMUNES | {"granularity"})
    zona_id, desde, hasta = _uuid(zoneId), _fecha(dateFrom, "dateFrom"), _fecha(dateTo, "dateTo")
    _rango(desde, hasta)
    try:
        calendario = periodos(desde, hasta, granularity)
    except ErrorDominio as error:
        raise HTTPException(error.status, error.mensaje) from error
    regla = regla_publicacion()
    grupo = _grupo(fuentes, zona_id, segmentId, desde, hasta)
    datos = fuentes.canastas_por_producto(zona_id, segmentId, desde, hasta, _as_of(asOf), granularity)

    por_clave = {p["periodStart"]: p for p in datos["periods"]}
    filas_por_clave: dict[str, list] = {}
    for fila in datos["data"]:
        filas_por_clave.setdefault(fila["periodStart"], []).append(fila)
    serie = []
    for p in calendario:
        periodo = por_clave.get(p["key"], {"baskets": 0, "stores": 0, "totalSpend": 0})
        filas = filas_por_clave.get(p["key"], [])
        disponible, motivo = evaluar(periodo["baskets"], periodo["stores"], regla)
        punto = {"periodStart": p["periodStart"], "periodEnd": p["periodEnd"],
                 "coverage": {"baskets": periodo["baskets"], "stores": periodo["stores"]},
                 "disponible": disponible, "motivo": motivo,
                 "averageTicket": None, "productsPerBasket": None, "typicalSize": None}
        if disponible:
            calculado = resumen(periodo, filas, 1.0)
            punto.update({"averageTicket": calculado["averageTicket"],
                          "productsPerBasket": calculado["productsPerBasket"],
                          "typicalSize": tamano_tipico(periodo, filas)})
        serie.append(punto)
    return {"group": grupo, "granularity": granularity, "asOf": datos["asOf"], "publicationRule": regla,
            "data": serie}


# --- GET /v1/category-mix

@router.get(
    "/v1/category-mix",
    summary="Mezcla del gasto del grupo por categoría de producto, con la publicación de D-36.",
    description="Reutiliza `GET /v1/analytics/spend-by-category` de core-process (`share` de 0 a 100, de mayor a "
                "menor gasto). No acepta `asOf`: core-process no lo ofrece en esa lectura.",
    responses={
        200: ejemplos.respuesta("La mezcla por categoría.", ejemplos.MEZCLA, RAICES_XML["/v1/category-mix"]),
        **ejemplos.errores("/v1/category-mix", 400, 401, 403, 404, 503),
    },
)
def mezcla_por_categoria(
    request: Request,
    zoneId: ZonaId,
    segmentId: SegmentoId,
    dateFrom: Fecha = None,
    dateTo: Fecha = None,
    _usuario: dict = _LECTORES,
    fuentes: Fuentes = Depends(obtener_fuentes),
) -> dict:
    _solo(request, {"zoneId", "segmentId", "dateFrom", "dateTo"})
    zona_id, desde, hasta = _uuid(zoneId), _fecha(dateFrom, "dateFrom"), _fecha(dateTo, "dateTo")
    _rango(desde, hasta)
    regla = regla_publicacion()
    grupo = _grupo(fuentes, zona_id, segmentId, desde, hasta)
    # spend-by-category no trae tiendas: la cobertura de D-36 sale de basket-products.
    cobertura = fuentes.canastas_por_producto(zona_id, segmentId, desde, hasta)
    periodo = cobertura["periods"][0] if cobertura["periods"] else {"baskets": 0, "stores": 0}
    disponible, motivo = evaluar(periodo["baskets"], periodo["stores"], regla)
    respuesta = {"group": grupo, "period": {"dateFrom": dateFrom, "dateTo": dateTo}, "publicationRule": regla,
                 "coverage": {"baskets": periodo["baskets"], "stores": periodo["stores"]},
                 "disponible": disponible, "motivo": motivo, "data": None}
    if disponible:
        respuesta["data"] = [{"categoryId": c.get("categoryId"), "categoryName": c["categoryName"],
                              "totalSpend": c["totalSpend"], "basketCount": c["basketCount"], "share": c["share"]}
                             for c in fuentes.gasto_por_categoria(zona_id, segmentId, desde, hasta)]
    return respuesta
