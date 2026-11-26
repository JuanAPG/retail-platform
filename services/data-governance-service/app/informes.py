"""Reporte de calidad (DG-7, DG-8) y evaluación de retención (DG-10), con lo que exponen los dueños.

Un dueño que no responde o no expone lo necesario afecta solo a su fuente o conjunto: sale
`disponible: false` con el motivo, nunca 0 y nunca un 503 del reporte completo.
"""
from __future__ import annotations

from datetime import date

from . import calidad
from .fuentes import Fuentes, SinDueno
from .retencion import fecha_de_corte

#: Las fuentes que tienen métricas, en el orden del reporte.
FUENTES_MEDIBLES = ("ventas-archivo", "capturas-campo", "inegi-enigh")
_MOTIVO_VENTANA_CAPTURAS = "Sobre todo el historial: availability-service no filtra capturas por fecha todavía."
#: Conjuntos cuyo dueño no expone todavía un conteo por fecha (contrato: *Lo que se pide*).
_SIN_CONTEO = {
    "capturas_disponibilidad": "availability-service no filtra capturas por fecha todavía (pedido en el contrato).",
    "observaciones_precio": "pricing-service no expone un conteo por fecha de las observaciones.",
    "visitas_campo": "catalog-service no expone un conteo por fecha de las visitas.",
    "notificaciones": "notifications-service ya archiva a los 90 días y no expone un conteo global.",
}


def calidad_de(clave: str, fuentes: Fuentes, desde: date | None, hasta: date | None, hoy: date,
               dias_ventas: int, dias_segmentos: int) -> dict:
    """Métricas de una fuente medible. Si su dueño falla, solo esta fuente queda sin medir."""
    try:
        if clave == "ventas-archivo":
            lotes, ultimo = fuentes.lotes(desde, hasta)
            try:
                rechazos, motivo = fuentes.rechazos(lotes), None
            except SinDueno as error:
                rechazos, motivo = None, error.motivo
            return calidad.ventas_archivo(lotes, rechazos, motivo, ultimo, hoy, dias_ventas)
        if clave == "capturas-campo":
            c = fuentes.capturas()
            return calidad.capturas_campo(c["capturas"], c["conflicto"], c["existencias"], c["vencidas"],
                                          _MOTIVO_VENTANA_CAPTURAS)
        return calidad.inegi_enigh(fuentes.vigencias_segmentos(), hoy, dias_segmentos)
    except SinDueno as error:
        metricas = ("freshness",) if clave == "inegi-enigh" else calidad.METRICAS
        return calidad.fuente_caida(metricas, error.motivo)


def reporte_calidad(fuentes_registradas: dict[str, dict], fuentes: Fuentes, desde: date | None, hasta: date | None,
                    clave: str | None, hoy: date, medido_en: str, dias_ventas: int, dias_segmentos: int) -> dict:
    """`fuentes_registradas`: clave → fuente de la base (nombre y dueño)."""
    claves = [clave] if clave else [k for k in FUENTES_MEDIBLES if k in fuentes_registradas]
    salida = []
    for k in claves:
        fuente = fuentes_registradas[k]
        salida.append({"sourceKey": k, "sourceName": fuente["name"], "ownerService": fuente["ownerService"],
                       **calidad_de(k, fuentes, desde, hasta, hoy, dias_ventas, dias_segmentos)})
    return {"dateFrom": desde.isoformat() if desde else None, "dateTo": hasta.isoformat() if hasta else None,
            "measuredAt": medido_en, "sources": salida}


def evaluacion(politicas: list[dict], fuentes: Fuentes, as_of: date) -> dict:
    """DG-10: para cada conjunto, `cutoffDate = asOf − plazo` y cuántos datos vencerían (fecha ≤ corte),
    pedidos al dueño. Un `asOf` futuro simula sobre los datos reales sin tocar nada."""
    datos = []
    for p in politicas:
        corte = fecha_de_corte(as_of, p["retentionPeriod"])
        fila = {"dataset": p["dataset"], "ownerService": p["ownerService"], "retentionPeriod": p["retentionPeriod"],
                "cutoffDate": corte.isoformat() if corte else None, "expiredCount": None}
        if corte is None:
            fila.update(disponible=True, motivo="Sin borrado: nunca vence (D-43).")
        elif p["dataset"] == "transacciones":
            try:
                fila.update(expiredCount=fuentes.transacciones_hasta(corte), disponible=True, motivo=None)
            except SinDueno as error:
                fila.update(disponible=False, motivo=error.motivo)
        else:
            fila.update(disponible=False, motivo=_SIN_CONTEO.get(p["dataset"], f"{p['ownerService']} no expone un conteo por fecha."))
        datos.append(fila)
    return {"asOf": as_of.isoformat(), "data": datos}
