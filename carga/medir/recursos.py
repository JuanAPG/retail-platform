"""CPU, RAM, red y disco por contenedor mientras corre Locust (`docker stats`), más el tamaño de las bases.

Corre EN EL HOST DE LOS CONTENEDORES (tu equipo, o la VM de staging por SSH), en otra terminal, al mismo
tiempo que Locust:

    python carga/medir/recursos.py carga/resultados/<corrida> --cada 5 --duracion 800
    python carga/medir/recursos.py carga/resultados/<corrida> --resumir      # solo rehace el resumen

Escribe `<prefijo>_recursos.csv` (una fila por contenedor y muestra) y `<prefijo>_recursos.md`
(promedio y máximo por contenedor; tamaño de Postgres y de Mongo al final). Solo biblioteca estándar.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

UNIDADES = {'b': 1 / 1024 ** 2, 'kb': 1 / 1024, 'kib': 1 / 1024, 'mb': 1, 'mib': 1, 'gb': 1024, 'gib': 1024,
            'tb': 1024 ** 2, 'tib': 1024 ** 2}
CAMPOS = ['instante', 'contenedor', 'cpu_pct', 'mem_mib', 'mem_pct', 'red_entrada_mib', 'red_salida_mib',
          'disco_lectura_mib', 'disco_escritura_mib']


def a_mib(texto: str) -> float:
    """'123.4MiB' / '1.2GB' / '0B' -> MiB."""
    m = re.fullmatch(r'\s*([\d.]+)\s*([a-zA-Z]+)\s*', texto)
    if not m:
        return 0.0
    return float(m.group(1)) * UNIDADES.get(m.group(2).lower(), 0.0)


def par(texto: str) -> tuple[float, float]:
    """'1.2MB / 3.4MB' -> (1.14, 3.24) en MiB."""
    a, _, b = texto.partition('/')
    return a_mib(a), a_mib(b)


def fila_de_stats(linea: str, instante: str) -> dict:
    """Una línea de `docker stats --no-stream --format '{{json .}}'`."""
    d = json.loads(linea)
    red = par(d.get('NetIO', '0B / 0B'))
    disco = par(d.get('BlockIO', '0B / 0B'))
    return {'instante': instante, 'contenedor': d['Name'], 'cpu_pct': float(d['CPUPerc'].rstrip('%') or 0),
            'mem_mib': round(par(d['MemUsage'])[0], 1), 'mem_pct': float(d['MemPerc'].rstrip('%') or 0),
            'red_entrada_mib': round(red[0], 2), 'red_salida_mib': round(red[1], 2),
            'disco_lectura_mib': round(disco[0], 2), 'disco_escritura_mib': round(disco[1], 2)}


def muestrear() -> list[dict]:
    salida = subprocess.run(['docker', 'stats', '--no-stream', '--format', '{{json .}}'],
                            capture_output=True, text=True, check=True).stdout
    ahora = datetime.now(timezone.utc).isoformat(timespec='seconds')
    return [fila_de_stats(l, ahora) for l in salida.splitlines() if l.strip()]


def resumir(filas: list[dict]) -> list[dict]:
    """Promedio y máximo de CPU y RAM por contenedor; red y disco son acumulados (diferencia fin - inicio)."""
    por = defaultdict(list)
    for f in filas:
        por[f['contenedor']].append(f)
    salida = []
    for nombre, fs in sorted(por.items()):
        cpu = [float(f['cpu_pct']) for f in fs]
        mem = [float(f['mem_mib']) for f in fs]
        delta = lambda campo: round(max(0.0, float(fs[-1][campo]) - float(fs[0][campo])), 2)
        salida.append({'contenedor': nombre, 'muestras': len(fs), 'cpu_prom': round(sum(cpu) / len(cpu), 1),
                       'cpu_max': round(max(cpu), 1), 'mem_prom_mib': round(sum(mem) / len(mem), 1),
                       'mem_max_mib': round(max(mem), 1), 'red_mib': round(delta('red_entrada_mib') + delta('red_salida_mib'), 2),
                       'disco_escrito_mib': delta('disco_escritura_mib')})
    return sorted(salida, key=lambda r: -r['cpu_prom'])


def tamanos_bases(contenedor_pg: str, contenedor_mongo: str, mongo_uri: str) -> dict:
    """Tamaño de Postgres (base y 8 tablas más grandes) y de Mongo (por colección)."""
    salida: dict = {}
    sql = ("SELECT 'BASE', pg_database_size(current_database()) UNION ALL "
           "SELECT * FROM (SELECT relname, pg_total_relation_size(relid) FROM pg_statio_user_tables "
           "ORDER BY 2 DESC LIMIT 8) t")
    r = subprocess.run(['docker', 'exec', contenedor_pg, 'psql', '-U', 'retail_user', '-d', 'retaildb', '-At', '-F', '|',
                        '-c', sql], capture_output=True, text=True)
    if r.returncode == 0:
        salida['postgres'] = {n: round(int(b) / 1024 ** 2, 2) for n, b in (l.split('|') for l in r.stdout.split())}
    js = ('const r={};db.getCollectionNames().forEach(c=>{const s=db.getCollection(c).stats();'
          'r[c]={docs:s.count,mib:+((s.storageSize+s.totalIndexSize)/1048576).toFixed(2)}});print(JSON.stringify(r))')
    r = subprocess.run(['docker', 'exec', contenedor_mongo, 'mongosh', '--quiet', mongo_uri, '--eval', js],
                       capture_output=True, text=True)
    if r.returncode == 0 and r.stdout.strip():
        salida['mongo'] = json.loads(r.stdout.strip().splitlines()[-1])
    return salida


def markdown(resumen: list[dict], bases: dict, cada: float) -> str:
    l = [f'# Recursos por contenedor (muestra cada {cada} s)', '',
         '| Contenedor | Muestras | CPU % prom | CPU % máx | RAM MiB prom | RAM MiB máx | Red MiB | Disco escrito MiB |',
         '|---|---|---|---|---|---|---|---|']
    for r in resumen:
        l.append(f"| {r['contenedor']} | {r['muestras']} | {r['cpu_prom']} | {r['cpu_max']} | {r['mem_prom_mib']} | "
                 f"{r['mem_max_mib']} | {r['red_mib']} | {r['disco_escrito_mib']} |")
    if bases.get('postgres'):
        l += ['', '## Postgres (MiB, con índices)', '', '| Relación | MiB |', '|---|---|']
        l += [f'| {n} | {v} |' for n, v in bases['postgres'].items()]
    if bases.get('mongo'):
        l += ['', '## Mongo', '', '| Colección | Documentos | MiB (datos + índices) |', '|---|---|---|']
        l += [f"| {n} | {v['docs']} | {v['mib']} |" for n, v in sorted(bases['mongo'].items())]
    l += ['', 'CPU de `docker stats`: 100 % = un núcleo. Red y disco: lo acumulado durante la medición.']
    return '\n'.join(l) + '\n'


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Muestrea docker stats durante la carga.')
    parser.add_argument('prefijo', type=Path)
    parser.add_argument('--cada', type=float, default=5)
    parser.add_argument('--duracion', type=float, default=800, help='Segundos (la forma completa dura 780)')
    parser.add_argument('--resumir', action='store_true', help='No muestrea: rehace el resumen del CSV')
    parser.add_argument('--postgres', default='retail_postgres')
    parser.add_argument('--mongo', default='retail_mongodb')
    parser.add_argument('--mongo-uri', default='mongodb://retail_admin:retail_pass_2026@localhost:27017/retaildb?authSource=admin',
                        help='La de infra/docker-compose.yml (local); en staging, la del ambiente')
    args = parser.parse_args(argv)
    archivo = Path(f'{args.prefijo}_recursos.csv')
    if not args.resumir:
        archivo.parent.mkdir(parents=True, exist_ok=True)
        fin = time.monotonic() + args.duracion
        with archivo.open('w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=CAMPOS)
            w.writeheader()
            n = 0
            while time.monotonic() < fin:
                inicio = time.monotonic()
                for fila in muestrear():
                    w.writerow(fila)
                f.flush()
                n += 1
                print(f'\r  muestra {n}', end='', flush=True)
                time.sleep(max(0.0, args.cada - (time.monotonic() - inicio)))
        print()
    with archivo.open(encoding='utf-8', newline='') as f:
        resumen = resumir(list(csv.DictReader(f)))
    bases = tamanos_bases(args.postgres, args.mongo, args.mongo_uri)
    Path(f'{args.prefijo}_recursos.md').write_text(markdown(resumen, bases, args.cada), encoding='utf-8')
    print(f'Listo: {archivo.name} y {args.prefijo.name}_recursos.md ({len(resumen)} contenedores)')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
