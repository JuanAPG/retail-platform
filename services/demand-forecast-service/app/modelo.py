"""Holt-Winters aditivo (ETS A,A,A) de statsmodels: validación, pronóstico e intervalos (D-40).

DF-4: menos de 12 semanas → 422. DF-5: periodo estacional `SEASONAL_PERIOD` (4); statsmodels
exige dos ciclos completos para ajustar, así que menos de `2 × periodo` semanas de ajuste → 422.
DF-6: se ajusta con las primeras n − 4 semanas, sin ver las 4 reservadas, y el MAPE (%) se calcula
solo sobre las reservadas con venta > 0. DF-7: se reajusta con toda la historia y se proyectan 8
semanas con intervalos analíticos de 80 % y 95 %; un límite inferior negativo se recorta a 0.

Determinista: misma serie, mismo resultado (D-15). No hay simulación ni semilla de por medio.
"""
from __future__ import annotations

import math
import warnings
from datetime import date, timedelta

import numpy as np
import pandas as pd
import statsmodels
from statsmodels.tsa.exponential_smoothing.ets import ETSModel

from .dominio import (HORIZONTE_SEMANAS, MIN_SEMANAS, NIVELES_INTERVALO, SEMANAS_RESERVADAS,
                      ErrorDominio)

#: Parámetros que estima ETS(A,A,A) con periodo 4: nivel, tendencia y 4 estacionales iniciales
#: más 3 suavizamientos (α, β, γ). Con menos semanas de ajuste que esto + 7, se avisa.
SEMANAS_COMODAS = 16


def _ajustar(valores: np.ndarray, periodo: int):
    modelo = ETSModel(pd.Series(valores, dtype=float), error="add", trend="add", seasonal="add",
                      seasonal_periods=periodo)
    with warnings.catch_warnings():
        # ConvergenceWarning con series casi perfectas: el ajuste igual es válido y determinista.
        warnings.simplefilter("ignore")
        return modelo.fit(disp=False)


def _finito(valor: float) -> float | None:
    """Un AIC de un ajuste perfecto sale ±inf: en JSON y XML va como nulo, nunca como Infinity."""
    return float(valor) if math.isfinite(valor) else None


def validar_historia(semanas: int, periodo: int) -> None:
    """DF-4 y DF-5, antes de ajustar nada."""
    if semanas < MIN_SEMANAS:
        raise ErrorDominio(
            f"Hay {semanas} semanas de historia; el pronóstico necesita al menos {MIN_SEMANAS} (D-40).")
    ajuste = semanas - SEMANAS_RESERVADAS
    if ajuste < 2 * periodo:
        raise ErrorDominio(
            f"Hay {ajuste} semanas para ajustar el modelo y una estacionalidad de {periodo} semanas "
            f"necesita al menos {2 * periodo} (dos ciclos completos, DF-5).")


def pronosticar(serie: list[dict], periodo: int) -> dict:
    """Validación (DF-6), pronóstico (DF-7) y parámetros del ajuste final.

    `serie`: `[{weekStart, quantity, filled}]` ya rellenada y convertida (DF-2, DF-3).
    Devuelve `{validation, forecast, model, limitations}`.
    """
    validar_historia(len(serie), periodo)
    y = np.array([s["quantity"] for s in serie], dtype=float)
    entrenamiento, reservadas = y[:-SEMANAS_RESERVADAS], y[-SEMANAS_RESERVADAS:]

    # --- DF-6: el ajuste de validación no ve las 4 reservadas.
    pred_validacion = _ajustar(entrenamiento, periodo).forecast(SEMANAS_RESERVADAS).to_numpy()
    con_venta = reservadas > 0
    if con_venta.any():
        errores = np.abs((reservadas[con_venta] - pred_validacion[con_venta]) / reservadas[con_venta])
        mape, motivo_mape = float(np.mean(errores) * 100), None
    else:
        mape = None
        motivo_mape = (f"Las {SEMANAS_RESERVADAS} semanas reservadas no tienen ventas: el MAPE divide entre "
                       "la venta real y no se puede calcular.")
    semanas_reservadas = serie[-SEMANAS_RESERVADAS:]
    validacion = {
        "trainWeeks": len(entrenamiento),
        "holdoutWeeks": SEMANAS_RESERVADAS,
        "mape": mape,
        "mapeWeeks": int(con_venta.sum()),
        "zeroWeeksExcluded": int((~con_venta).sum()),
        "motivo": motivo_mape,
        "holdout": [{"weekStart": s["weekStart"], "actual": float(reservadas[i]), "forecast": float(pred_validacion[i])}
                    for i, s in enumerate(semanas_reservadas)],
    }

    # --- DF-7: ajuste final con toda la historia, 8 semanas con intervalos analíticos.
    final = _ajustar(y, periodo)
    prediccion = final.get_prediction(start=len(y), end=len(y) + HORIZONTE_SEMANAS - 1)
    marcos = {nivel: prediccion.summary_frame(alpha=1 - nivel / 100) for nivel in NIVELES_INTERVALO}
    ultima = date.fromisoformat(serie[-1]["weekStart"])
    pronostico, recortadas = [], 0
    for i in range(HORIZONTE_SEMANAS):
        fila = {"weekStart": (ultima + timedelta(weeks=i + 1)).isoformat(),
                "quantity": float(marcos[NIVELES_INTERVALO[-1]]["mean"].iloc[i])}
        recorte = False
        for nivel in NIVELES_INTERVALO:
            inferior = float(marcos[nivel]["pi_lower"].iloc[i])
            if inferior < 0:
                inferior, recorte = 0.0, True
            fila[f"lower{nivel}"] = inferior
            fila[f"upper{nivel}"] = float(marcos[nivel]["pi_upper"].iloc[i])
        if fila["quantity"] < 0:
            fila["quantity"], recorte = 0.0, True
        fila["clipped"] = recorte
        recortadas += recorte
        pronostico.append(fila)

    rellenadas = sum(1 for s in serie if s["filled"])
    limitaciones = [f"Estacionalidad de {periodo} semanas (≈ un mes). La anual necesitaría al menos 108 "
                    "semanas de historia."]
    if rellenadas:
        limitaciones.append(f"Una semana sin ventas cuenta como 0 ({rellenadas} "
                            f"{'semana rellenada' if rellenadas == 1 else 'semanas rellenadas'}).")
    if recortadas:
        limitaciones.append(f"Un límite inferior negativo se recortó a 0 en {recortadas} "
                            f"{'semana' if recortadas == 1 else 'semanas'} del pronóstico.")
    if len(entrenamiento) < SEMANAS_COMODAS:
        limitaciones.append(f"Pocas semanas: el modelo estima 9 parámetros con {len(entrenamiento)} datos en la "
                            "validación, así que el pronóstico es frágil.")

    return {
        "validation": validacion,
        "forecast": pronostico,
        "model": {
            "library": f"statsmodels {statsmodels.__version__}",
            "smoothingLevel": float(final.smoothing_level),
            "smoothingTrend": float(final.smoothing_trend),
            "smoothingSeasonal": float(final.smoothing_seasonal),
            "aic": _finito(final.aic),
        },
        "limitations": limitaciones,
    }
