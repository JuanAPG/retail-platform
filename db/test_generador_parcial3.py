"""Pruebas del generador del Parcial 3 (solo biblioteca estándar).

    python -m unittest db/test_generador_parcial3.py -v

Cada prueba vuelve a leer los CSV generados y comprueba los casos de control desde los datos, no
desde el código que los sembró.
"""
import csv
import hashlib
import json
import sys
import tempfile
import unittest
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generar_datos_parcial3 as gen  # noqa: E402

TRANSACCIONES = 6000


def generar(carpeta: Path, *extra: str) -> dict:
    gen.main(['--transacciones', str(TRANSACCIONES), '--salida', str(carpeta), *extra])
    return json.loads((carpeta / 'manifiesto.json').read_text(encoding='utf-8'))


def leer_ventas(carpeta: Path) -> dict[str, dict]:
    """folio -> {tienda, dia, lineas[]} leyendo todos los ventas-*.csv."""
    ventas: dict[str, dict] = {}
    for archivo in sorted(carpeta.glob('ventas-*.csv')):
        with archivo.open(encoding='utf-8', newline='') as f:
            for fila in csv.DictReader(f):
                v = ventas.setdefault(fila['folio'], {'tienda': fila['tienda'], 'fecha': fila['fecha'],
                                                      'lineas': [], 'archivo': archivo.name})
                v['lineas'].append(fila)
    return ventas


class GeneradorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name) / 'a'
        cls.manifiesto = generar(cls.dir)
        cls.catalogo = json.loads((cls.dir / 'catalogo.json').read_text(encoding='utf-8'))
        cls.ventas = leer_ventas(cls.dir)
        cls.zona_de = {t['nombre']: t['zona'] for t in cls.catalogo['tiendas']}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def ventas_de(self, zona: str):
        return [v for v in self.ventas.values() if self.zona_de[v['tienda']] == zona]

    # --- reproducible e idempotente

    def test_misma_semilla_mismos_bytes(self):
        otro = generar(Path(self.tmp.name) / 'b')
        self.assertEqual(otro['sha256'], self.manifiesto['sha256'])
        self.assertEqual([a['sha256'] for a in otro['archivos']], [a['sha256'] for a in self.manifiesto['archivos']])

    def test_otra_semilla_otros_datos(self):
        otro = generar(Path(self.tmp.name) / 'c', '--semilla', '7')
        self.assertNotEqual(otro['sha256'], self.manifiesto['sha256'])

    def test_manifiesto_cuadra_con_los_archivos(self):
        for a in self.manifiesto['archivos']:
            contenido = (self.dir / a['archivo']).read_bytes()
            self.assertEqual(len(contenido), a['bytes'])
            self.assertEqual(hashlib.sha256(contenido).hexdigest(), a['sha256'])
        self.assertEqual(self.manifiesto['totales']['transacciones'], TRANSACCIONES)
        self.assertEqual(len(self.ventas), TRANSACCIONES)

    # --- formato de la importación de core-process

    def test_encabezado_y_campos(self):
        for archivo in self.dir.glob('ventas-*.csv'):
            self.assertEqual(archivo.read_text(encoding='utf-8').splitlines()[0],
                             'folio,fecha,tienda,sku,presentacion,cantidad,precio')
        skus = {p['sku']: {pr['nombre'] for pr in p['presentaciones']} for p in self.catalogo['productos']}
        for v in self.ventas.values():
            self.assertIn(v['tienda'], self.zona_de)
            self.assertTrue(v['fecha'].endswith('-06'))
            self.assertLessEqual(len(v['lineas'][0]['folio']), 40)
            presentaciones = [l['presentacion'] for l in v['lineas']]
            for l in v['lineas']:
                self.assertIn(l['presentacion'], skus[l['sku']])
                self.assertGreater(int(l['cantidad']), 0)
                self.assertRegex(l['precio'], r'^\d+\.\d{2}$')
            # core-process rechaza la misma presentación repetida dentro de una venta
            pares = [(l['sku'], l['presentacion']) for l in v['lineas']]
            self.assertEqual(len(pares), len(set(pares)), v['lineas'][0]['folio'])

    def test_fechas_dentro_de_la_ventana(self):
        p = self.manifiesto['parametros']
        desde, hasta = date.fromisoformat(p['desde']), date.fromisoformat(p['hasta'])
        self.assertEqual(desde.weekday(), 0)
        self.assertEqual(hasta.weekday(), 6)
        for v in self.ventas.values():
            self.assertTrue(desde <= date.fromisoformat(v['fecha'][:10]) <= hasta)

    def test_archivos_bajo_el_tope_y_folios_completos(self):
        chico = Path(self.tmp.name) / 'chico'
        m = generar(chico, '--max-mb', '0.2')
        self.assertGreater(len(m['archivos']), 1)
        for a in m['archivos']:
            self.assertLessEqual(a['bytes'], 0.2 * 1024 * 1024)
        ventas = leer_ventas(chico)
        # Un folio nunca queda partido entre dos archivos (core-process agrupa por folio).
        archivos_por_folio = defaultdict(set)
        for archivo in chico.glob('ventas-*.csv'):
            with archivo.open(encoding='utf-8', newline='') as f:
                for fila in csv.DictReader(f):
                    archivos_por_folio[fila['folio']].add(archivo.name)
        self.assertTrue(all(len(a) == 1 for a in archivos_por_folio.values()))
        self.assertEqual(len(ventas), TRANSACCIONES)

    # --- tope de líneas por archivo (límite de la vista previa de core-process)

    def lineas_de_datos(self, carpeta: Path) -> dict[str, int]:
        return {a.name: len(a.read_text(encoding='utf-8').splitlines()) - 1
                for a in sorted(carpeta.glob('ventas-*.csv'))}

    def test_default_bajo_el_limite_de_core(self):
        self.assertLessEqual(gen.MAX_LINEAS_DEFAULT, gen.LIMITE_LINEAS_CORE)
        self.assertEqual(gen.LIMITE_LINEAS_CORE, 4095)
        self.assertEqual(self.manifiesto['parametros']['maxLineas'], gen.MAX_LINEAS_DEFAULT)
        self.assertTrue(all(n <= gen.MAX_LINEAS_DEFAULT for n in self.lineas_de_datos(self.dir).values()))

    def test_tope_de_lineas_respetado(self):
        carpeta = Path(self.tmp.name) / 'tope500'
        m = generar(carpeta, '--max-lineas', '500')
        lineas = self.lineas_de_datos(carpeta)
        self.assertGreater(len(lineas), 1)
        self.assertTrue(all(n <= 500 for n in lineas.values()), lineas)
        # No corta de más: cada archivo, salvo el último, quedó cerca del tope.
        self.assertTrue(all(n > 450 for n in list(lineas.values())[:-1]), lineas)
        self.assertEqual(m['parametros']['maxLineas'], 500)

    def test_tope_de_lineas_no_parte_folios(self):
        carpeta = Path(self.tmp.name) / 'tope300'
        m = generar(carpeta, '--max-lineas', '300')
        archivos_por_folio = defaultdict(set)
        for archivo in carpeta.glob('ventas-*.csv'):
            with archivo.open(encoding='utf-8', newline='') as f:
                for fila in csv.DictReader(f):
                    archivos_por_folio[fila['folio']].add(archivo.name)
        self.assertTrue(all(len(a) == 1 for a in archivos_por_folio.values()))
        self.assertEqual(len(archivos_por_folio), TRANSACCIONES)
        self.assertEqual(m['totales']['transacciones'], TRANSACCIONES)
        # El tope solo reparte: las mismas ventas, línea por línea, que sin tope.
        self.assertEqual(leer_ventas(carpeta).keys(), self.ventas.keys())
        self.assertEqual(m['totales']['lineas'], self.manifiesto['totales']['lineas'])

    def test_lineas_del_manifiesto_cuadran(self):
        reales = self.lineas_de_datos(self.dir)
        self.assertEqual({a['archivo']: a['lineas'] for a in self.manifiesto['archivos']}, reales)
        self.assertEqual(self.manifiesto['totales']['lineas'], sum(reales.values()))

    def test_los_dos_topes_juntos(self):
        # Gana el MB: 0.05 MB son ~650 líneas, menos que el tope de 1000.
        por_mb = Path(self.tmp.name) / 'gana-mb'
        m = generar(por_mb, '--max-mb', '0.05', '--max-lineas', '1000')
        self.assertTrue(all(a['bytes'] <= 0.05 * 1024 * 1024 for a in m['archivos']))
        self.assertLess(max(self.lineas_de_datos(por_mb).values()), 1000)
        # Gana el de líneas: 300 líneas pesan mucho menos que 4.5 MB.
        por_lineas = Path(self.tmp.name) / 'gana-lineas'
        m = generar(por_lineas, '--max-mb', '4.5', '--max-lineas', '300')
        self.assertTrue(all(n <= 300 for n in self.lineas_de_datos(por_lineas).values()))
        self.assertGreater(len(m['archivos']), self.manifiesto['totales']['lineas'] // 300)

    def test_max_lineas_cero_desactiva(self):
        carpeta = Path(self.tmp.name) / 'sin-tope'
        m = generar(carpeta, '--max-lineas', '0')
        # 6,000 transacciones caben en un solo archivo de menos de 4.5 MB.
        self.assertEqual(len(m['archivos']), 1)
        self.assertGreater(m['archivos'][0]['lineas'], gen.LIMITE_LINEAS_CORE)
        self.assertEqual(m['totales']['lineas'], self.manifiesto['totales']['lineas'])

    def test_tope_menor_a_una_venta(self):
        # Falla antes de escribir: una corrida previa en la misma carpeta queda intacta.
        carpeta = Path(self.tmp.name) / 'invalido'
        previo = generar(carpeta, '--max-lineas', '2000')
        for extra in (['--max-lineas', '1'], ['--max-lineas', '-5'], ['--max-mb', '0.0001']):
            with self.subTest(extra=extra):
                with self.assertRaises(ValueError):
                    generar(carpeta, *extra)
                for a in previo['archivos']:
                    self.assertEqual(hashlib.sha256((carpeta / a['archivo']).read_bytes()).hexdigest(), a['sha256'])
                self.assertEqual(len(list(carpeta.glob('ventas-*.csv'))), len(previo['archivos']))

    def test_folio_unico_por_tienda(self):
        vistos = set()
        for folio, v in self.ventas.items():
            self.assertNotIn((v['tienda'], folio), vistos)
            vistos.add((v['tienda'], folio))

    # --- tiendas y zonas

    def test_tres_o_mas_tiendas_con_venta_en_las_zonas_normales(self):
        for zona in ('Zona Valle', 'Zona Centro', 'Zona Oriente'):
            self.assertGreaterEqual(len({v['tienda'] for v in self.ventas_de(zona)}), 3)

    def test_zona_chica_no_cumple_d36(self):
        norte = self.ventas_de('Zona Norte')
        self.assertEqual(len(norte), 9)
        self.assertEqual(len({v['tienda'] for v in norte}), 2)

    # --- casos de control

    def control(self, ident: str) -> dict:
        return next(c for c in self.manifiesto['controles'] if c['id'] == ident)

    def test_d37_frontera_20_y_19(self):
        c = self.control('D-37-frontera')
        desde, hasta = date.fromisoformat(c['dateFrom']), date.fromisoformat(c['dateTo'])
        grupo = [v for v in self.ventas_de(c['zona']) if desde <= date.fromisoformat(v['fecha'][:10]) <= hasta]
        self.assertEqual(len(grupo), c['canastas'])
        self.assertEqual(len(grupo) % 100, 0)
        con = lambda sku: sum(1 for v in grupo if any(l['sku'] == sku for l in v['lineas']))
        self.assertEqual(con(gen.CTRL_FRONTERA_20) * 100, len(grupo) * 20)
        self.assertEqual(con(gen.CTRL_FRONTERA_19) * 100, len(grupo) * 19)

    def test_d36_pocas_ventas(self):
        sku, zona, n = gen.CTRL_POCAS_VENTAS
        self.assertEqual(sum(1 for v in self.ventas_de(zona) if any(l['sku'] == sku for l in v['lineas'])), n)

    def test_patron_semanal_exacto(self):
        sku, zona = gen.CTRL_PATRON
        inicio = date.fromisoformat(self.manifiesto['parametros']['desde'])
        por_semana = defaultdict(int)
        precios = set()
        for v in self.ventas_de(zona):
            semana = (date.fromisoformat(v['fecha'][:10]) - inicio).days // 7
            for l in v['lineas']:
                if l['sku'] == sku:
                    por_semana[semana] += int(l['cantidad'])
                    precios.add(l['precio'])
        semanas = self.manifiesto['parametros']['semanas']
        self.assertEqual([por_semana[t] for t in range(semanas)],
                         [gen.total_semana_patron(t) for t in range(semanas)])
        self.assertEqual(len(precios), 1)  # sin efecto de precio

    def test_historia_de_11_y_12_semanas(self):
        hasta = date.fromisoformat(self.manifiesto['parametros']['hasta'])
        for sku, semanas in gen.CTRL_LANZAMIENTO.items():
            for zona in ('Zona Valle', 'Zona Centro', 'Zona Oriente'):
                dias = [date.fromisoformat(v['fecha'][:10]) for v in self.ventas_de(zona)
                        if any(l['sku'] == sku for l in v['lineas'])]
                primer_lunes = min(dias) - timedelta(days=min(dias).weekday())
                self.assertEqual((hasta + timedelta(days=1) - primer_lunes).days // 7, semanas, (sku, zona))
                # D-36 no debe tapar el caso: al menos 10 transacciones y 3 tiendas.
                ventas = [v for v in self.ventas_de(zona) if any(l['sku'] == sku for l in v['lineas'])]
                self.assertGreaterEqual(len(ventas), 10)
                self.assertGreaterEqual(len({v['tienda'] for v in ventas}), 3)

    def test_huevo_con_dos_tipos_de_unidad(self):
        huevo = next(p for p in self.catalogo['productos'] if p['sku'] == gen.CTRL_UNIDADES_MEZCLADAS)
        self.assertEqual({p['unidadMedida'] for p in huevo['presentaciones']}, {'pza', 'kg'})
        vendidas = {l['presentacion'] for v in self.ventas.values() for l in v['lineas']
                    if l['sku'] == gen.CTRL_UNIDADES_MEZCLADAS}
        self.assertEqual(vendidas, {'12 pza', '1 kg'})

    def test_asociacion_sembrada_tiene_lift_mayor_a_1(self):
        for antecedente, consecuente, _ in gen.ASOCIACIONES:
            canastas = [{l['sku'] for l in v['lineas']} for v in self.ventas.values()]
            n = len(canastas)
            con_a = sum(1 for c in canastas if antecedente in c)
            con_b = sum(1 for c in canastas if consecuente in c)
            con_ab = sum(1 for c in canastas if antecedente in c and consecuente in c)
            lift = (con_ab / n) / ((con_a / n) * (con_b / n))
            self.assertGreater(lift, 1.2, (antecedente, consecuente))

    def test_perfil_por_segmento(self):
        """Ingreso alto compra más productos por canasta que ingreso bajo."""
        media = lambda zona: sum(len(v['lineas']) for v in self.ventas_de(zona)) / len(self.ventas_de(zona))
        self.assertGreater(media('Zona Valle'), media('Zona Oriente'))

    def test_parametros_invalidos(self):
        with self.assertRaises(ValueError):
            gen.Generador(10000, 52, date(2026, 11, 21), 4, 42)   # no es domingo
        with self.assertRaises(ValueError):
            gen.Generador(1000, 52, date(2026, 11, 22), 4, 42)    # muy pocas transacciones
        with self.assertRaises(ValueError):
            gen.Generador(10000, 10, date(2026, 11, 22), 4, 42)   # muy pocas semanas


if __name__ == '__main__':
    unittest.main()
