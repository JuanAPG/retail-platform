"""Medición del pronóstico (D-40) para la ficha del algoritmo (docs/ficha-algoritmo-complejo.md).

    python scripts/medir_pronostico.py --datos ../../db/generados/10000 --salida ../../carga/resultados/pronostico-10k

Lee los `ventas-*.csv` y `catalogo.json` del generador y arma, por producto × zona y por producto en
todas las zonas, la MISMA serie que el servicio (semana local de Monterrey, unidad base por producto
DF-2, semanas sin venta en 0 DF-3, ventana hasta `--hasta`). Luego llama a las funciones del
servicio: `publicacion.evaluar` (D-36), `modelo.pronosticar` (DF-4 a DF-7). Solo cambia el origen de
las ventas (CSV en vez de `GET /v1/analytics/weekly-sales` de core-process), así que mide el modelo
sin red ni base.

Reporta: series ajustadas y rechazadas (con su motivo), tiempo por ajuste, distribución del MAPE, y
los casos de control del generador (manifiesto.json): serie exacta del azúcar en Zona Valle, 11 y 12
semanas de historia y unidades mezcladas. Corre en la imagen del servicio (statsmodels no tiene
rueda para Python 3.14).
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
import time
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import modelo, publicacion  # noqa: E402
from app.dominio import MIN_TIENDAS, MIN_TRANSACCIONES, ErrorDominio, periodo_estacional  # noqa: E402
from app.semanas import lunes_de, serie_semanal  # noqa: E402
from app.unidades import convertir  # noqa: E402

#: `unidadMedida` del generador → tipo y factor a la unidad base (catalog-service: `unidades_medida`).
UNIDADES = {'kg': ('masa', 1), 'g': ('masa', 0.001), 'l': ('volumen', 1), 'ml': ('volumen', 0.001),
            'pza': ('pieza', 1)}


def presentaciones_del_catalogo(catalogo: dict) -> dict[str, list[dict]]:
    """SKU → presentaciones con el formato que espera `unidades.convertir` (id = 'SKU|nombre')."""
    salida = {}
    for p in catalogo['productos']:
        salida[p['sku']] = [{'id': f"{p['sku']}|{x['nombre']}", 'contenido': x['contenido'],
                             'unidadMedida': {'tipo': UNIDADES[x['unidadMedida']][0],
                                              'factorBase': UNIDADES[x['unidadMedida']][1]}}
                            for x in p['presentaciones']]
    return salida


def leer_ventas(carpeta: Path, zona_de_tienda: dict[str, str]):
    """(sku, zona) → {semana: {presentación: cantidad}}, más transacciones y tiendas por (sku, zona)."""
    cantidades = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    folios, tiendas = defaultdict(set), defaultdict(set)
    for archivo in sorted(carpeta.glob('ventas-*.csv')):
        with archivo.open(encoding='utf-8', newline='') as f:
            for r in csv.DictReader(f):
                zona = zona_de_tienda[r['tienda']]
                semana = lunes_de(date.fromisoformat(r['fecha'][:10])).isoformat()   # fecha ya va en hora local
                for clave in ((r['sku'], zona), (r['sku'], None)):
                    cantidades[clave][semana][f"{r['sku']}|{r['presentacion']}"] += float(r['cantidad'])
                    folios[clave].add(r['folio'])
                    tiendas[clave].add(r['tienda'])
    return cantidades, folios, tiendas


def medir_serie(clave, por_semana_y_pres, presentaciones, n_folios, n_tiendas, hasta: date, periodo: int) -> dict:
    sku, zona = clave
    fila = {'sku': sku, 'zona': zona or 'todas', 'transacciones': n_folios, 'tiendas': n_tiendas}
    disponible, motivo = publicacion.evaluar(n_folios, n_tiendas, 'ambos', zona is not None)
    fila['publicable'] = disponible
    filas = [{'weekStart': s, 'presentationId': pid, 'quantity': q}
             for s, por_pres in por_semana_y_pres.items() for pid, q in por_pres.items()]
    inicio = time.perf_counter()
    try:
        convertida = convertir(filas, presentaciones)
        serie = serie_semanal({date.fromisoformat(s.isoformat() if isinstance(s, date) else s): q
                               for s, q in convertida['porSemana'].items()}, hasta)
        fila['semanas'] = len(serie)
        fila['rellenadas'] = sum(1 for s in serie if s['filled'])
        r = modelo.pronosticar(serie, periodo)
        fila.update({'estado': 201, 'mape': r['validation']['mape'], 'unidad': convertida['unit'],
                     'recortadas': sum(1 for x in r['forecast'] if x['clipped']), 'limitaciones': len(r['limitations'])})
    except ErrorDominio as e:
        fila.update({'estado': 422, 'motivo': str(e)})
    fila['ms'] = round((time.perf_counter() - inicio) * 1000, 1)
    if not disponible:
        fila['motivoPublicacion'] = motivo
    return fila


def percentil(valores: list[float], p: float) -> float | None:
    if not valores:
        return None
    v = sorted(valores)
    return v[min(len(v) - 1, int(round(p / 100 * (len(v) - 1))))]


def resumen(filas: list[dict], manifiesto: dict) -> dict:
    ok = [f for f in filas if f['estado'] == 201]
    motivos = defaultdict(int)
    for f in filas:
        if f['estado'] == 422:
            motivos[f['motivo'].split(':')[0][:70]] += 1
    tiempos = [f['ms'] for f in ok]
    mapes = [f['mape'] for f in ok if f['mape'] is not None]
    ctrl = {c['id']: c for c in manifiesto['controles']}
    buscar = lambda sku, zona='todas': next((f for f in filas if f['sku'] == sku and f['zona'] == zona), None)
    patron = ctrl['D-40-patron']
    controles = {
        'D-40-patron': buscar(patron['sku'], patron['zona']),
        **{c: buscar(ctrl[c]['sku']) for c in ('D-40-historia-11', 'D-40-historia-12', 'DF-2-unidades-mezcladas')},
    }
    return {
        'series': len(filas), 'ajustadas': len(ok), 'rechazadas': len(filas) - len(ok), 'motivos422': dict(motivos),
        'noPublicables': sum(1 for f in filas if not f['publicable']),
        'msPorAjuste': {'p50': percentil(tiempos, 50), 'p95': percentil(tiempos, 95), 'max': max(tiempos, default=None),
                        'total': round(sum(f['ms'] for f in filas), 1)},
        'mape': {'p50': percentil(mapes, 50), 'p90': percentil(mapes, 90), 'max': max(mapes, default=None),
                 'conMape': len(mapes)},
        'controles': controles,
    }


def markdown(r: dict, etiqueta: str) -> str:
    l = [f'## Pronóstico, {etiqueta}', '',
         f"{r['series']} series (producto × zona y producto en todas las zonas): {r['ajustadas']} ajustadas, "
         f"{r['rechazadas']} con 422; {r['noPublicables']} no publicables por D-36 "
         f"(≥ {MIN_TRANSACCIONES} transacciones y ≥ {MIN_TIENDAS} tiendas).", '',
         '| Medida | p50 | p95 / p90 | Máx |', '|---|---|---|---|',
         f"| ms por ajuste (validación + final) | {r['msPorAjuste']['p50']} | {r['msPorAjuste']['p95']} | {r['msPorAjuste']['max']} |",
         f"| MAPE % (4 semanas reservadas) | {r['mape']['p50'] and round(r['mape']['p50'], 1)} | "
         f"{r['mape']['p90'] and round(r['mape']['p90'], 1)} | {r['mape']['max'] and round(r['mape']['max'], 1)} |",
         '', f"Tiempo total de todas las series: {r['msPorAjuste']['total']} ms.", '',
         '| Motivo del 422 | Series |', '|---|---|']
    l += [f'| {m} | {n} |' for m, n in sorted(r['motivos422'].items())]
    l += ['', '| Control | Semanas | Estado | MAPE | Nota |', '|---|---|---|---|---|']
    for nombre, f in r['controles'].items():
        if f is None:
            l.append(f'| {nombre} | — | no encontrado | | |')
            continue
        l.append(f"| {nombre} ({f['sku']}, {f['zona']}) | {f.get('semanas', '—')} | {f['estado']} | "
                 f"{round(f['mape'], 2) if f.get('mape') is not None else '—'} | {f.get('motivo', '')[:90]} |")
    return '\n'.join(l) + '\n'


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Mide el pronóstico Holt-Winters sobre los datos del generador.')
    parser.add_argument('--datos', type=Path, required=True)
    parser.add_argument('--salida', type=Path, required=True)
    parser.add_argument('--hasta', type=date.fromisoformat, default=None,
                        help='Última semana (domingo). Default: la del manifiesto del generador.')
    args = parser.parse_args(argv)
    manifiesto = json.loads((args.datos / 'manifiesto.json').read_text(encoding='utf-8'))
    catalogo = json.loads((args.datos / 'catalogo.json').read_text(encoding='utf-8'))
    hasta = args.hasta or date.fromisoformat(manifiesto['parametros']['hasta'])
    zona_de_tienda = {t['nombre']: t['zona'] for t in catalogo['tiendas']}
    presentaciones = presentaciones_del_catalogo(catalogo)
    periodo = periodo_estacional()

    inicio = time.perf_counter()
    cantidades, folios, tiendas = leer_ventas(args.datos, zona_de_tienda)
    lectura_ms = round((time.perf_counter() - inicio) * 1000, 1)
    filas = [medir_serie(clave, cantidades[clave], presentaciones[clave[0]], len(folios[clave]), len(tiendas[clave]),
                         hasta, periodo)
             for clave in sorted(cantidades, key=lambda c: (c[0], c[1] or ''))]
    r = resumen(filas, manifiesto)
    etiqueta = f"{manifiesto['parametros']['transacciones']:,} ventas (generador {manifiesto['generador'].split()[-1]})"
    args.salida.parent.mkdir(parents=True, exist_ok=True)
    Path(f'{args.salida}.json').write_text(json.dumps({'datos': str(args.datos), 'hasta': hasta.isoformat(),
                                                       'periodo': periodo, 'lecturaMs': lectura_ms, **r, 'filas': filas},
                                                      ensure_ascii=False, indent=1), encoding='utf-8')
    Path(f'{args.salida}.md').write_text(markdown(r, etiqueta), encoding='utf-8')
    print(f"{r['series']} series: {r['ajustadas']} ajustadas, {r['rechazadas']} con 422 · "
          f"{r['msPorAjuste']['p50']} ms p50 por ajuste · MAPE p50 {r['mape']['p50']} → {args.salida}.md")
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
