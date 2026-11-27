"""Planes de consulta e índices usados en PostgreSQL y MongoDB, con el volumen cargado.

    python carga/medir/planes.py carga/resultados/<corrida>            # local (docker exec)
    python carga/medir/planes.py carga/resultados/<corrida> --volumen 100k

Ejecuta `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` de las consultas que de verdad corren los servicios
(copiadas de su código, con los mismos filtros) y `explain('executionStats')` de las lecturas de Mongo.
Escribe `<prefijo>_planes.json` (planes completos) y `<prefijo>_planes.md` (tiempo, filas, buffers,
índices usados y recorridos secuenciales). En staging se corre en la VM, donde viven los contenedores.

Las consultas SÍ se ejecutan (ANALYZE): son lecturas, pero sobre 500k ventas tardan; no las corras a
media medición de Locust.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ZONA_NEGOCIO = 'America/Monterrey'   # la sesión de algorithms-core y core-process corre en ella

# Copias de services/algorithms-core/src/fuente-datos/fuente-datos.service.ts (LINEAS_VENTA_SQL,
# LINEAS_DE_CANASTA_SQL) y de core-process (listado de transacciones), con los parámetros ya puestos.
LINEAS_VENTA = """
  SELECT d.presentacion_id, k.zona_id, k.id AS canasta_id, k.fecha, d.cantidad, d.precio_unitario
  FROM transacciones_detalle d
  JOIN canastas k ON k.transaccion_id = d.transaccion_id
  WHERE ({pres}::uuid IS NULL OR d.presentacion_id = {pres}::uuid)
    AND ({desde}::date IS NULL OR k.fecha >= {desde}::date)
    AND ({hasta}::date IS NULL OR k.fecha < {hasta}::date + 1)"""

CONSULTAS = {
    'elasticidad_semanal_todas': {
        'servicio': 'algorithms-core', 'ruta': 'POST /v1/elasticity/calculate {granularity: week}',
        'sql': """WITH lineas AS (""" + LINEAS_VENTA.format(pres='NULL', desde='NULL', hasta='NULL') + """)
         SELECT presentacion_id, zona_id, to_char(date_trunc('week', fecha), 'YYYY-MM-DD') AS period,
                SUM(cantidad)::float8, SUM(cantidad * precio_unitario)::float8
         FROM lineas GROUP BY 1, 2, 3"""},
    'elasticidad_una_presentacion': {
        'servicio': 'algorithms-core', 'ruta': 'POST /v1/elasticity/calculate {presentationId}',
        'sql': """WITH lineas AS (""" + LINEAS_VENTA.format(pres="'{presentacion}'", desde='NULL', hasta='NULL') + """)
         SELECT presentacion_id, zona_id, to_char(date_trunc('week', fecha), 'YYYY-MM-DD') AS period,
                SUM(cantidad)::float8, SUM(cantidad * precio_unitario)::float8
         FROM lineas GROUP BY 1, 2, 3"""},
    'canastas_apriori_mes': {
        'servicio': 'algorithms-core', 'ruta': 'POST /v1/association/apriori/run (zona, segmento, un mes)',
        'sql': """SELECT DISTINCT k.id, p.id, p.categoria_id, to_char(k.fecha, 'YYYY-MM-DD')
         FROM canastas k
         JOIN transacciones t ON t.id = k.transaccion_id
         JOIN transacciones_detalle d ON d.transaccion_id = k.transaccion_id
         JOIN producto_presentaciones pp ON pp.id = d.presentacion_id
         JOIN productos p ON p.id = pp.producto_id
         WHERE k.zona_id = '{zona}'::uuid AND k.segmento_ingreso_id = {segmento}
           AND k.fecha >= DATE '{mes_desde}' AND k.fecha < DATE '{mes_hasta}' + 1"""},
    'transacciones_recientes': {
        'servicio': 'core-process-service', 'ruta': 'GET /v1/transactions?limit=20',
        'sql': """SELECT t.* FROM transacciones t ORDER BY t.fecha DESC, t.id DESC LIMIT 20"""},
    'transacciones_total': {
        'servicio': 'core-process-service', 'ruta': 'GET /v1/transactions (total del listado)',
        'sql': """SELECT COUNT(*) FROM transacciones t"""},
    'cobertura_zona': {
        'servicio': 'availability-service', 'ruta': 'GET /v1/availability/zones/:id/coverage (existencias)',
        'sql': """SELECT i.tienda_id, i.presentacion_id, i.stock_disponible, i.actualizado_en
         FROM inventario i JOIN tiendas t ON t.id = i.tienda_id WHERE t.zona_id = '{zona}'::uuid"""},
}
TABLAS = ('transacciones', 'transacciones_detalle', 'canastas', 'inventario', 'producto_presentaciones', 'productos')

# Lecturas de Mongo con el mismo filtro y orden que usan los servicios (índices en getIndexes()).
MONGO_JS = r"""
const uno = (c) => db.getCollection(c).findOne() || {};
const casos = {
  forecast_runs: (d) => db.forecast_runs.find({userId: d.userId}).sort({date: -1}).limit(20),
  analysis_runs: (d) => db.analysis_runs.find({type: d.type}).sort({date: -1}).limit(20),
  lotes_sync: (d) => db.lotes_sync.find({userId: d.userId}).sort({receivedAt: -1}).limit(20),
  capturas_sync: (d) => db.capturas_sync.find({type: d.type, storeId: d.storeId, presentationId: d.presentationId}).sort({capturedAt: -1}).limit(1),
  monitoreo_sondeos: (d) => db.monitoreo_sondeos.find({service: d.service}).sort({checkedAt: -1}).limit(50),
  notificaciones: (d) => db.notificaciones.find({recipientUserId: d.recipientUserId}).sort({createdAt: -1}).limit(20),
};
const salida = {};
for (const [c, consulta] of Object.entries(casos)) {
  if (!db.getCollectionNames().includes(c)) continue;
  const e = consulta(uno(c)).explain('executionStats');
  salida[c] = {plan: e.queryPlanner.winningPlan, stats: {nReturned: e.executionStats.nReturned,
    totalDocsExamined: e.executionStats.totalDocsExamined, totalKeysExamined: e.executionStats.totalKeysExamined,
    executionTimeMillis: e.executionStats.executionTimeMillis}, docs: db.getCollection(c).estimatedDocumentCount()};
}
print(JSON.stringify(salida));
"""


def recorrer(nodo: dict):
    yield nodo
    for hijo in nodo.get('Plans', []):
        yield from recorrer(hijo)


def analizar_pg(plan_json: list) -> dict:
    """De un EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) a lo que se reporta."""
    raiz = plan_json[0]
    nodos = list(recorrer(raiz['Plan']))
    indices = sorted({n['Index Name'] for n in nodos if n.get('Index Name')})
    secuenciales = [{'tabla': n.get('Relation Name'), 'filas': n.get('Actual Rows', 0) * n.get('Actual Loops', 1)}
                    for n in nodos if n['Node Type'] == 'Seq Scan']
    p = raiz['Plan']
    return {'ejecucion_ms': round(raiz.get('Execution Time', 0), 2), 'planeacion_ms': round(raiz.get('Planning Time', 0), 2),
            'filas': p.get('Actual Rows'), 'nodo_raiz': p['Node Type'],
            'buffers_hit': p.get('Shared Hit Blocks', 0), 'buffers_read': p.get('Shared Read Blocks', 0),
            'indices': indices, 'secuenciales': secuenciales,
            'temporal_en_disco': any(n.get('Sort Space Type') == 'Disk' or n.get('Temp Written Blocks', 0) for n in nodos)}


def etapas_mongo(plan: dict) -> list[dict]:
    salida, nodo = [], plan
    while nodo:
        salida.append({'stage': nodo.get('stage'), 'index': nodo.get('indexName')})
        nodo = nodo.get('inputStage')
    return salida


def analizar_mongo(r: dict) -> dict:
    etapas = etapas_mongo(r['plan'])
    return {'etapas': [e['stage'] for e in etapas], 'indice': next((e['index'] for e in etapas if e['index']), None),
            'coleccion_completa': any(e['stage'] == 'COLLSCAN' for e in etapas), 'docs': r['docs'], **r['stats']}


class Psql:
    def __init__(self, contenedor: str):
        self.base = ['docker', 'exec', '-i', contenedor, 'psql', '-U', 'retail_user', '-d', 'retaildb', '-At', '-v', 'ON_ERROR_STOP=1']

    def __call__(self, sql: str) -> str:
        r = subprocess.run(self.base + ['-c', f"SET TIME ZONE '{ZONA_NEGOCIO}'", '-c', sql], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip())
        return r.stdout.split('\n', 1)[1] if r.stdout.startswith('SET') else r.stdout


def parametros(psql: Psql) -> dict:
    """Ids reales: la presentación más vendida, Zona Centro con su segmento y el último mes completo con ventas."""
    pres = psql('SELECT presentacion_id FROM transacciones_detalle GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1').strip()
    zona, seg = psql("SELECT zona_id, segmento_ingreso_id FROM canastas GROUP BY 1, 2 ORDER BY COUNT(*) DESC LIMIT 1").strip().split('|')
    mes = psql("SELECT to_char(date_trunc('month', max(fecha)) - interval '1 month', 'YYYY-MM-DD'), "
               "to_char(date_trunc('month', max(fecha)) - interval '1 day', 'YYYY-MM-DD') FROM canastas").strip().split('|')
    return {'presentacion': pres, 'zona': zona, 'segmento': seg, 'mes_desde': mes[0], 'mes_hasta': mes[1]}


def markdown(r: dict) -> str:
    l = [f"# Planes de consulta ({r['volumen']}, {r['ambiente']})", '',
         f"Parámetros: {json.dumps(r['parametros'], ensure_ascii=False)}", '', '## PostgreSQL', '',
         '| Consulta | Servicio y ruta | Ejecución ms | Filas | Buffers hit / read | Índices usados | Recorridos secuenciales | Temporal en disco |',
         '|---|---|---|---|---|---|---|---|']
    for nombre, c in r['postgres'].items():
        if 'error' in c:
            l.append(f"| {nombre} | {c['ruta']} | error: {c['error'][:80]} | | | | | |")
            continue
        a = c['analisis']
        seq = ', '.join(f"{s['tabla']} ({s['filas']:,})" for s in a['secuenciales']) or '—'
        l.append(f"| {nombre} | {c['servicio']}: `{c['ruta']}` | {a['ejecucion_ms']} | {a['filas']} | "
                 f"{a['buffers_hit']} / {a['buffers_read']} | {', '.join(a['indices']) or '—'} | {seq} | "
                 f"{'sí' if a['temporal_en_disco'] else 'no'} |")
    l += ['', '### Índices y uso acumulado (`pg_stat_user_indexes`)', '', '| Tabla | Índice | Escaneos | Definición |', '|---|---|---|---|']
    l += [f"| {i['tabla']} | {i['indice']} | {i['escaneos']} | `{i['definicion']}` |" for i in r['indices']]
    l += ['', '## MongoDB', '', '| Colección | Documentos | Etapas | Índice | Docs examinados | Devueltos | ms |', '|---|---|---|---|---|---|---|']
    for c, a in r['mongo'].items():
        l.append(f"| {c} | {a['docs']} | {' ← '.join(a['etapas'])} | {a['indice'] or '— (COLLSCAN)'} | "
                 f"{a['totalDocsExamined']} | {a['nReturned']} | {a['executionTimeMillis']} |")
    return '\n'.join(l) + '\n'


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='EXPLAIN de las consultas pesadas en Postgres y Mongo.')
    parser.add_argument('prefijo', type=Path)
    parser.add_argument('--volumen', default='10k', help='Etiqueta del dataset cargado (10k, 100k, 500k)')
    parser.add_argument('--ambiente', default='local')
    parser.add_argument('--postgres', default='retail_postgres')
    parser.add_argument('--mongo', default='retail_mongodb')
    parser.add_argument('--mongo-uri', default='mongodb://retail_admin:retail_pass_2026@localhost:27017/retaildb?authSource=admin')
    args = parser.parse_args(argv)
    psql = Psql(args.postgres)
    params = parametros(psql)
    salida = {'volumen': args.volumen, 'ambiente': args.ambiente, 'parametros': params, 'postgres': {}, 'mongo': {}}
    for nombre, c in CONSULTAS.items():
        entrada = {'servicio': c['servicio'], 'ruta': c['ruta']}
        try:
            plan = json.loads(psql('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + c['sql'].format(**params)))
            entrada.update({'analisis': analizar_pg(plan), 'plan': plan})
        except RuntimeError as e:
            entrada['error'] = str(e)
        salida['postgres'][nombre] = entrada
        print(f"  {nombre}: {entrada.get('analisis', {}).get('ejecucion_ms', entrada.get('error'))} ms")
    filas = psql("SELECT s.relname, s.indexrelname, s.idx_scan, i.indexdef FROM pg_stat_user_indexes s "
                 "JOIN pg_indexes i ON i.indexname = s.indexrelname WHERE s.relname IN ("
                 + ', '.join(f"'{t}'" for t in TABLAS) + ') ORDER BY 1, 3 DESC')
    salida['indices'] = [dict(zip(('tabla', 'indice', 'escaneos', 'definicion'), l.split('|', 3))) for l in filas.splitlines() if l]
    r = subprocess.run(['docker', 'exec', args.mongo, 'mongosh', '--quiet', args.mongo_uri, '--eval', MONGO_JS],
                       capture_output=True, text=True)
    if r.returncode == 0 and r.stdout.strip():
        salida['mongo'] = {c: analizar_mongo(v) for c, v in json.loads(r.stdout.strip().splitlines()[-1]).items()}
    else:
        print(f'  Mongo: {r.stderr.strip()[:200]}')
    args.prefijo.parent.mkdir(parents=True, exist_ok=True)
    Path(f'{args.prefijo}_planes.json').write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding='utf-8')
    Path(f'{args.prefijo}_planes.md').write_text(markdown(salida), encoding='utf-8')
    print(f'Listo: {args.prefijo.name}_planes.md')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
