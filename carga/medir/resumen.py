"""Resumen de una corrida de Locust: por servicio, por ruta y por etapa de la forma de la carga.

    python carga/medir/resumen.py carga/resultados/<corrida>          # lee <corrida>_stats.csv, etc.
    python carga/medir/resumen.py carga/resultados/<corrida> --ambiente staging

Lee los CSV que deja `locust --csv <prefijo>` (`_stats.csv`, `_failures.csv`, `_stats_history.csv`) y
escribe junto a ellos `<prefijo>_resumen.md` y `<prefijo>_resumen.json`. Las fallas se separan en
HTTP (código no esperado), NEGOCIO (código bien, cuerpo mal) y LIMITADO (429, aparte de las fallas).

Locust da percentiles por ruta, no por servicio: el p95 de un servicio es el PEOR p95 de sus rutas
(cota superior, se dice en la tabla). Solo biblioteca estándar.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import escenario as esc  # noqa: E402

PERCENTILES = ('50%', '95%', '99%')


def _num(valor: str) -> float:
    try:
        return float(valor)
    except (TypeError, ValueError):
        return 0.0


def servicio_de(nombre: str) -> str:
    """Las rutas se nombran '<servicio> <plantilla>' en el locustfile."""
    return nombre.split(' ', 1)[0]


def limpiar_error(texto: str) -> str:
    """`CatchResponseError('NEGOCIO: …')` -> `NEGOCIO: …`."""
    m = re.fullmatch(r"CatchResponseError\((['\"])(.*)\1\)", texto.strip(), re.S)
    return m.group(2) if m else texto


def leer_stats(filas: list[dict]) -> dict:
    """Filas de `_stats.csv` -> rutas (sin Aggregated), filas LIMITADO y el agregado."""
    rutas, limitadas, total = [], [], None
    for f in filas:
        if f['Name'] == 'Aggregated':
            total = f
        elif f['Type'] == 'LIMITADO':
            limitadas.append(f)
        else:
            rutas.append(f)
    return {'rutas': rutas, 'limitadas': limitadas, 'total': total}


def clasificar_fallas(filas: list[dict]) -> dict[str, dict[str, int]]:
    """`_failures.csv` -> {ruta: {'http': n, 'negocio': n}}."""
    salida: dict[str, dict[str, int]] = defaultdict(lambda: {'http': 0, 'negocio': 0})
    for f in filas:
        clase = 'negocio' if f"{esc.PREFIJO_NEGOCIO}:" in f['Error'] else 'http'
        salida[f['Name']][clase] += int(f['Occurrences'])
    return dict(salida)


def por_servicio(rutas: list[dict], fallas: dict, limitadas: list[dict]) -> list[dict]:
    grupos: dict[str, dict] = {}
    lim = defaultdict(int)
    for f in limitadas:
        lim[servicio_de(f['Name'])] += int(f['Request Count'])
    for r in rutas:
        s = servicio_de(r['Name'])
        g = grupos.setdefault(s, {'servicio': s, 'peticiones': 0, 'http': 0, 'negocio': 0, 'suma_ms': 0.0,
                                  'p95_peor': 0.0, 'p99_peor': 0.0, 'max_ms': 0.0, 'rps': 0.0, 'ruta_p95': ''})
        n = int(r['Request Count'])
        g['peticiones'] += n
        g['suma_ms'] += _num(r['Average Response Time']) * n
        g['rps'] += _num(r['Requests/s'])
        g['max_ms'] = max(g['max_ms'], _num(r['Max Response Time']))
        if _num(r['95%']) > g['p95_peor']:
            g['p95_peor'], g['ruta_p95'] = _num(r['95%']), r['Name'].split(' ', 1)[1]
        g['p99_peor'] = max(g['p99_peor'], _num(r['99%']))
        f = fallas.get(r['Name'], {})
        g['http'] += f.get('http', 0)
        g['negocio'] += f.get('negocio', 0)
    salida = []
    for s, g in sorted(grupos.items()):
        g['promedio_ms'] = round(g.pop('suma_ms') / g['peticiones'], 1) if g['peticiones'] else 0.0
        g['limitado'] = lim.get(s, 0)
        g['tasa_falla'] = round((g['http'] + g['negocio']) / g['peticiones'] * 100, 2) if g['peticiones'] else 0.0
        g['rps'] = round(g['rps'], 2)
        salida.append(g)
    return salida


def por_etapa(historia: list[dict], etapas=esc.ETAPAS, escala_tiempo: float = 1.0) -> list[dict]:
    """`_stats_history.csv` (una fila por segundo, la de Aggregated) -> métricas por etapa de la forma."""
    filas = [h for h in historia if h.get('Name') == 'Aggregated']
    if not filas:
        return []
    inicio = int(filas[0]['Timestamp'])
    grupos: dict[str, list[dict]] = defaultdict(list)
    for h in filas:
        actual = esc.etapa_en((int(h['Timestamp']) - inicio) / escala_tiempo, etapas)
        if actual:
            grupos[actual[0].nombre].append(h)
    salida = []
    for e in etapas:
        hs = grupos.get(e.nombre)
        if not hs:
            continue
        p95 = sorted(_num(h['95%']) for h in hs if h['95%'] not in ('', 'N/A'))
        salida.append({'etapa': e.nombre, 'usuarios_max': max(int(_num(h['User Count'])) for h in hs),
                       'rps_promedio': round(sum(_num(h['Requests/s']) for h in hs) / len(hs), 2),
                       'fallas_por_s_promedio': round(sum(_num(h['Failures/s']) for h in hs) / len(hs), 3),
                       'p95_mediana_ms': p95[len(p95) // 2] if p95 else None,
                       'p95_peor_ms': p95[-1] if p95 else None})
    return salida


def markdown(r: dict) -> str:
    t = r['total']
    lineas = [f"# Corrida `{r['corrida']}` ({r['ambiente']})", '',
              f"{t['peticiones']} peticiones, {t['fallas_http']} fallas HTTP, {t['fallas_negocio']} de negocio, "
              f"{t['limitado']} limitadas (429); p50 {t['p50']} ms, p95 {t['p95']} ms, p99 {t['p99']} ms, "
              f"{t['rps']} peticiones/s.", '',
              '## Por servicio', '',
              '| Servicio | Peticiones | Fallas HTTP | Fallas negocio | 429 | % falla | Promedio ms | p95 ms (peor ruta) | p99 ms | Máx ms |',
              '|---|---|---|---|---|---|---|---|---|---|']
    for s in r['servicios']:
        lineas.append(f"| {s['servicio']} | {s['peticiones']} | {s['http']} | {s['negocio']} | {s['limitado']} | "
                      f"{s['tasa_falla']} | {s['promedio_ms']} | {s['p95_peor']:.0f} (`{s['ruta_p95']}`) | "
                      f"{s['p99_peor']:.0f} | {s['max_ms']:.0f} |")
    if r['etapas']:
        lineas += ['', '## Por etapa', '', '| Etapa | Usuarios | Peticiones/s | Fallas/s | p95 mediana ms | p95 peor ms |',
                   '|---|---|---|---|---|---|']
        for e in r['etapas']:
            lineas.append(f"| {e['etapa']} | {e['usuarios_max']} | {e['rps_promedio']} | {e['fallas_por_s_promedio']} | "
                          f"{e['p95_mediana_ms']} | {e['p95_peor_ms']} |")
    if r['errores']:
        lineas += ['', '## Errores', '', '| Ruta | Error | Veces |', '|---|---|---|']
        for e in r['errores']:
            lineas.append(f"| {e['ruta']} | {e['error'][:160]} | {e['veces']} |")
    lineas += ['', 'El p95 por servicio es el de su ruta más lenta: Locust no da percentiles por grupo de rutas.']
    return '\n'.join(lineas) + '\n'


def resumir(prefijo: Path, ambiente: str, escala_tiempo: float = 1.0) -> dict:
    def leer(sufijo):
        archivo = Path(f'{prefijo}{sufijo}')
        if not archivo.exists():
            return []
        crudo = archivo.read_bytes()
        try:
            texto = crudo.decode('utf-8')
        except UnicodeDecodeError:   # Locust en Windows escribe los CSV con la página de códigos local
            texto = crudo.decode('cp1252', errors='replace')
        return list(csv.DictReader(io.StringIO(texto, newline='')))
    stats = leer_stats(leer('_stats.csv'))
    if stats['total'] is None:
        raise SystemExit(f'No encontré {prefijo}_stats.csv con la fila Aggregated.')
    fallas_csv = leer('_failures.csv')
    fallas = clasificar_fallas(fallas_csv)
    servicios = por_servicio(stats['rutas'], fallas, stats['limitadas'])
    t = stats['total']
    total = {'peticiones': int(t['Request Count']), 'fallas_http': sum(s['http'] for s in servicios),
             'fallas_negocio': sum(s['negocio'] for s in servicios),
             'limitado': sum(int(f['Request Count']) for f in stats['limitadas']),
             'p50': _num(t['50%']), 'p95': _num(t['95%']), 'p99': _num(t['99%']), 'rps': round(_num(t['Requests/s']), 2)}
    return {'corrida': prefijo.name, 'ambiente': ambiente, 'total': total, 'servicios': servicios,
            'etapas': por_etapa(leer('_stats_history.csv'), escala_tiempo=escala_tiempo),
            'errores': [{'ruta': f['Name'], 'error': limpiar_error(f['Error']), 'veces': int(f['Occurrences'])}
                        for f in fallas_csv]}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Resume una corrida de Locust por servicio y por etapa.')
    parser.add_argument('prefijo', type=Path, help='El mismo prefijo que se pasó a locust --csv')
    parser.add_argument('--ambiente', default='local', help='local | staging | … (va en el título: no mezclar)')
    parser.add_argument('--escala-tiempo', type=float, default=1.0, help='La misma que se pasó a Locust')
    args = parser.parse_args(argv)
    r = resumir(args.prefijo, args.ambiente, args.escala_tiempo)
    Path(f'{args.prefijo}_resumen.json').write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding='utf-8')
    Path(f'{args.prefijo}_resumen.md').write_text(markdown(r), encoding='utf-8')
    t = r['total']
    print(f"{t['peticiones']} peticiones · fallas HTTP {t['fallas_http']} · negocio {t['fallas_negocio']} · "
          f"429 {t['limitado']} · p95 {t['p95']} ms -> {args.prefijo}_resumen.md")
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
