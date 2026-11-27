"""Pruebas de las herramientas de medición (carga/medir/), sin Docker ni red.

    python -m unittest discover -s carga/tests -v
"""
import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / 'medir'))
import escenario as esc  # noqa: E402
import planes  # noqa: E402
import recursos  # noqa: E402
import redis_caido  # noqa: E402
import resumen  # noqa: E402
from destinos import PUERTOS  # noqa: E402

COLUMNAS = ('Type,Name,Request Count,Failure Count,Median Response Time,Average Response Time,Min Response Time,'
            'Max Response Time,Average Content Size,Requests/s,Failures/s,50%,66%,75%,80%,90%,95%,98%,99%,99.9%,99.99%,100%')


def fila(tipo, nombre, n, fallas, promedio, p95, p99, maximo, rps):
    return dict(zip(COLUMNAS.split(','), [tipo, nombre, str(n), str(fallas), '10', str(promedio), '1', str(maximo), '100',
                                           str(rps), '0', '10', '', '', '', '', str(p95), '', str(p99), '', '', str(maximo)]))


class ResumenTest(unittest.TestCase):
    def setUp(self):
        self.stats = [
            fila('GET', 'catalog-service /v1/products', 100, 2, 20, 50, 80, 120, 2.0),
            fila('GET', 'catalog-service /v1/stores', 50, 0, 10, 90, 95, 100, 1.0),
            fila('POST', 'offline-sync-service /v1/sync/batches', 30, 1, 60, 200, 260, 300, 0.5),
            fila('LIMITADO', 'auth-service /v1/auth/refresh', 3, 0, 5, 5, 5, 5, 0.1),
            fila('', 'Aggregated', 183, 3, 25, 150, 250, 300, 3.6),
        ]
        self.fallas = [
            {'Method': 'GET', 'Name': 'catalog-service /v1/products', 'Error': "CatchResponseError('503: x')", 'Occurrences': '2'},
            {'Method': 'POST', 'Name': 'offline-sync-service /v1/sync/batches',
             'Error': "CatchResponseError('NEGOCIO: precio_observado rechazada')", 'Occurrences': '1'},
        ]

    def test_fallas_http_y_de_negocio_separadas(self):
        f = resumen.clasificar_fallas(self.fallas)
        self.assertEqual(f['catalog-service /v1/products'], {'http': 2, 'negocio': 0})
        self.assertEqual(f['offline-sync-service /v1/sync/batches'], {'http': 0, 'negocio': 1})

    def test_por_servicio(self):
        s = resumen.leer_stats(self.stats)
        servicios = {g['servicio']: g for g in resumen.por_servicio(s['rutas'], resumen.clasificar_fallas(self.fallas),
                                                                    s['limitadas'])}
        cat = servicios['catalog-service']
        self.assertEqual((cat['peticiones'], cat['http'], cat['negocio']), (150, 2, 0))
        self.assertEqual(cat['promedio_ms'], round((20 * 100 + 10 * 50) / 150, 1))   # ponderado por peticiones
        self.assertEqual((cat['p95_peor'], cat['ruta_p95']), (90, '/v1/stores'))   # la ruta más lenta
        self.assertEqual(cat['tasa_falla'], round(2 / 150 * 100, 2))
        self.assertEqual(servicios['offline-sync-service']['negocio'], 1)
        self.assertNotIn('auth-service', servicios)            # LIMITADO no es una ruta
        self.assertEqual(s['limitadas'][0]['Request Count'], '3')

    def test_limpiar_error(self):
        self.assertEqual(resumen.limpiar_error("CatchResponseError('NEGOCIO: x')"), 'NEGOCIO: x')
        self.assertEqual(resumen.limpiar_error('ConnectionRefusedError(10061)'), 'ConnectionRefusedError(10061)')

    def test_por_etapa(self):
        historia = [{'Timestamp': str(1000 + t), 'User Count': str(u), 'Name': 'Aggregated', 'Requests/s': str(r),
                     'Failures/s': '0', '95%': str(p)}
                    for t, u, r, p in [(0, 5, 2, 40), (30, 5, 2, 60), (60, 10, 4, 80), (200, 25, 9, 120)]]
        etapas = {e['etapa']: e for e in resumen.por_etapa(historia)}
        self.assertEqual(etapas['calentamiento']['usuarios_max'], 5)
        self.assertEqual(etapas['calentamiento']['rps_promedio'], 2.0)
        self.assertEqual(etapas['baja']['p95_peor_ms'], 80)
        self.assertEqual(etapas['media']['usuarios_max'], 25)

    def test_resumir_desde_archivos(self):
        with tempfile.TemporaryDirectory() as d:
            prefijo = Path(d) / 'corrida'
            for sufijo, filas in (('_stats.csv', self.stats), ('_failures.csv', self.fallas)):
                with open(f'{prefijo}{sufijo}', 'w', encoding='utf-8', newline='') as f:
                    import csv
                    w = csv.DictWriter(f, fieldnames=list(filas[0]))
                    w.writeheader()
                    w.writerows(filas)
            r = resumen.resumir(prefijo, 'local')
            self.assertEqual((r['total']['peticiones'], r['total']['fallas_http'], r['total']['fallas_negocio'],
                              r['total']['limitado']), (183, 2, 1, 3))
            self.assertIn('NEGOCIO: precio_observado rechazada', resumen.markdown(r))
            self.assertIn('(local)', resumen.markdown(r))


class RecursosTest(unittest.TestCase):
    def test_unidades(self):
        self.assertEqual(recursos.a_mib('512MiB'), 512)
        self.assertEqual(recursos.a_mib('1.5GiB'), 1536)
        self.assertAlmostEqual(recursos.a_mib('2048kB'), 2)
        self.assertEqual(recursos.a_mib('0B'), 0)
        self.assertEqual(recursos.par('1.2MB / 3GB'), (1.2, 3072))

    def test_linea_de_docker_stats(self):
        linea = json.dumps({'Name': 'retail_postgres', 'CPUPerc': '12.50%', 'MemUsage': '85.5MiB / 7.59GiB',
                            'MemPerc': '1.10%', 'NetIO': '1.5MB / 800kB', 'BlockIO': '10MB / 2GB'})
        f = recursos.fila_de_stats(linea, '2026-11-27T04:00:00+00:00')
        self.assertEqual((f['contenedor'], f['cpu_pct'], f['mem_mib'], f['disco_escritura_mib']),
                         ('retail_postgres', 12.5, 85.5, 2048))

    def test_resumir(self):
        filas = [{'contenedor': 'a', 'cpu_pct': c, 'mem_mib': m, 'red_entrada_mib': r, 'red_salida_mib': r,
                  'disco_escritura_mib': d} for c, m, r, d in [(10, 100, 1, 5), (30, 300, 2, 9)]]
        r = recursos.resumir(filas)[0]
        self.assertEqual((r['cpu_prom'], r['cpu_max'], r['mem_max_mib'], r['red_mib'], r['disco_escrito_mib']),
                         (20.0, 30.0, 300.0, 2.0, 4.0))


PLAN = [{'Planning Time': 0.4, 'Execution Time': 12.3, 'Plan': {
    'Node Type': 'Hash Join', 'Actual Rows': 157, 'Shared Hit Blocks': 600, 'Shared Read Blocks': 3, 'Plans': [
        {'Node Type': 'Bitmap Heap Scan', 'Relation Name': 'transacciones_detalle', 'Actual Rows': 157, 'Actual Loops': 1,
         'Plans': [{'Node Type': 'Bitmap Index Scan', 'Index Name': 'idx_detalle_presentacion', 'Actual Rows': 157}]},
        {'Node Type': 'Seq Scan', 'Relation Name': 'canastas', 'Actual Rows': 10006, 'Actual Loops': 1},
        {'Node Type': 'Sort', 'Sort Space Type': 'Disk', 'Actual Rows': 10}]}}]


class PlanesTest(unittest.TestCase):
    def test_analizar_pg(self):
        a = planes.analizar_pg(PLAN)
        self.assertEqual((a['ejecucion_ms'], a['filas'], a['buffers_hit'], a['buffers_read']), (12.3, 157, 600, 3))
        self.assertEqual(a['indices'], ['idx_detalle_presentacion'])
        self.assertEqual(a['secuenciales'], [{'tabla': 'canastas', 'filas': 10006}])
        self.assertTrue(a['temporal_en_disco'])

    def test_analizar_mongo(self):
        r = {'plan': {'stage': 'LIMIT', 'inputStage': {'stage': 'FETCH', 'inputStage': {'stage': 'IXSCAN', 'indexName': 'userId_date'}}},
             'stats': {'nReturned': 18, 'totalDocsExamined': 18, 'totalKeysExamined': 18, 'executionTimeMillis': 2}, 'docs': 41}
        a = planes.analizar_mongo(r)
        self.assertEqual((a['etapas'], a['indice'], a['coleccion_completa']), (['LIMIT', 'FETCH', 'IXSCAN'], 'userId_date', False))
        sin = planes.analizar_mongo({**r, 'plan': {'stage': 'COLLSCAN'}})
        self.assertTrue(sin['coleccion_completa'])
        self.assertIsNone(sin['indice'])

    def test_consultas_con_parametros_completos(self):
        params = {'presentacion': str(uuid.uuid4()), 'zona': str(uuid.uuid4()), 'segmento': '2',
                  'mes_desde': '2026-10-01', 'mes_hasta': '2026-10-31'}
        for nombre, c in planes.CONSULTAS.items():
            sql = c['sql'].format(**params)
            self.assertNotIn('{', sql, nombre)
            self.assertIn(c['servicio'], PUERTOS, nombre)


class RedisCaidoTest(unittest.TestCase):
    def test_veredicto(self):
        ok = {'statusCode': 503, 'code': 'SERVICE_UNAVAILABLE'}
        self.assertEqual(redis_caido.veredicto_caida(503, ok, 2000), 'ok')
        self.assertIn('se esperaba 503', redis_caido.veredicto_caida(500, {'code': 'INTERNAL'}, 100))
        self.assertIn('se esperaba 503', redis_caido.veredicto_caida(401, {}, 100))   # fail-open sería grave
        self.assertIn('lento', redis_caido.veredicto_caida(503, ok, 9000))
        self.assertIn('SERVICE_UNAVAILABLE', redis_caido.veredicto_caida(503, {'code': 'INTERNAL'}, 100))
        self.assertEqual(redis_caido.veredicto_caida(None, None, 0), 'sin respuesta')

    def test_una_sonda_por_servicio_de_los_20(self):
        fx = esc.Fixtures(zonas=[{'id': str(uuid.uuid4()), 'nombre': 'Z', 'segmentId': 1}],
                          tiendas=[{'id': str(uuid.uuid4()), 'zonaId': None}],
                          productos=[{'id': str(uuid.uuid4()), 'sku': 'S', 'presentaciones': [str(uuid.uuid4())]}])
        sondas = redis_caido.sondas(fx)
        self.assertEqual({s['servicio'] for s in sondas}, set(PUERTOS))
        self.assertEqual(len(sondas), 20)
        for s in sondas:
            self.assertIn(s['perfil'], esc.LECTURAS)
            self.assertTrue(s['ruta'].startswith('/v1/'))


if __name__ == '__main__':
    unittest.main()
