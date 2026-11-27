"""Pruebas del cargador del Parcial 3, sin red (solo biblioteca estándar).

    python -m unittest db/test_cargador_parcial3.py -v

Un cliente falso devuelve las respuestas que da core-process (mismos campos y el mismo texto del
409 de archivo repetido, `transactions.service.ts`), así se valida qué hace el cargador con cada
una sin levantar servicios. La carga real contra el stack se mide aparte (db/README-generador.md).
"""
import hashlib
import json
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cargar_datos_parcial3 as carga  # noqa: E402
import generar_datos_parcial3 as gen  # noqa: E402

UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'
CSV = 'folio,fecha,tienda,sku,presentacion,cantidad,precio\nG-1,2026-11-02T10:00:00-06,Tienda,SKU,1 kg,1,10.00\n'


def conflicto(estado: str) -> dict:
    """409 de core-process cuando el mismo archivo (mismo SHA-256) ya se subió."""
    return {'statusCode': 409, 'error': 'CONFLICT',
            'message': f'Este archivo ya se cargó antes (importación {UUID}, estado {estado}).'}


def preview(filas_con_error: int = 0) -> dict:
    return {'importacionId': UUID, 'estado': 'validado' if not filas_con_error else 'con_errores',
            'filasValidas': 1, 'filasConError': filas_con_error,
            'errores': [{'fila': 2, 'codigo': 'SKU_INEXISTENTE'}] * filas_con_error}


def confirmacion(completa: bool = True) -> dict:
    return {'importacionId': UUID, 'estado': 'confirmado' if completa else 'validado', 'transaccionesCreadas': 1,
            'filasPendientes': 0 if completa else 1, 'completa': completa, 'omitidos': []}


class ClienteFalso:
    """Responde en orden y anota cada petición: (método, ruta, cuerpo, archivo)."""

    def __init__(self, *respuestas):
        self.respuestas = list(respuestas)
        self.peticiones = []

    def pedir(self, rol, metodo, servicio, ruta, cuerpo=None, archivo=None):
        self.peticiones.append((metodo, ruta, cuerpo, archivo.name if archivo else None))
        if not self.respuestas:
            raise AssertionError(f'Petición no esperada: {metodo} {ruta}')
        return self.respuestas.pop(0)

    def rutas(self):
        return [p[1] for p in self.peticiones]


class Datos:
    """Carpeta temporal con lo mínimo que lee el cargador: catálogo, manifiesto y CSV."""

    def __init__(self, archivos: int = 1, lineas: int = 1):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        entradas = []
        for i in range(1, archivos + 1):
            nombre = f'ventas-{i:04d}.csv'
            contenido = CSV.replace('G-1', f'G-{i}').encode()
            (self.dir / nombre).write_bytes(contenido)
            entradas.append({'archivo': nombre, 'transacciones': 1, 'lineas': lineas, 'bytes': len(contenido),
                             'sha256': hashlib.sha256(contenido).hexdigest()})
        (self.dir / 'catalogo.json').write_text(json.dumps({'zonas': [], 'tiendas': [], 'productos': []}))
        (self.dir / 'manifiesto.json').write_text(json.dumps(
            {'archivos': entradas, 'sha256': 'x', 'parametros': {}, 'totales': {}}))
        self.entradas = entradas

    def cargador(self, cliente) -> carga.Cargador:
        return carga.Cargador(cliente, self.dir)


class ImportarTest(unittest.TestCase):
    def setUp(self):
        self.datos = Datos()
        self.addCleanup(self.datos.tmp.cleanup)
        self.entrada = self.datos.entradas[0]

    def importar(self, *respuestas):
        cliente = ClienteFalso(*respuestas)
        return self.datos.cargador(cliente).importar(self.entrada), cliente

    def test_vista_previa_y_confirmacion(self):
        r, cliente = self.importar((201, preview()), (200, confirmacion()))
        self.assertEqual(r['resultado'], 'confirmado')
        self.assertEqual(r['transaccionesCreadas'], 1)
        self.assertEqual(cliente.rutas(), ['/v1/transactions/import/preview', '/v1/transactions/import/confirm'])
        self.assertEqual(cliente.peticiones[0][3], 'ventas-0001.csv')
        self.assertEqual(cliente.peticiones[1][2], {'previewId': UUID})

    def test_sha256_distinto_aborta(self):
        (self.datos.dir / 'ventas-0001.csv').write_bytes(CSV.replace('10.00', '99.00').encode())
        cliente = ClienteFalso()
        with self.assertRaisesRegex(carga.ErrorDeCarga, 'SHA-256'):
            self.datos.cargador(cliente).importar(self.entrada)
        self.assertEqual(cliente.peticiones, [])  # nada se sube

    def test_409_confirmado_se_salta(self):
        r, cliente = self.importar((409, conflicto('confirmado')))
        self.assertEqual(r['resultado'], 'ya cargado')
        self.assertEqual(r['importacionId'], UUID)
        self.assertEqual(cliente.rutas(), ['/v1/transactions/import/preview'])  # no confirma otra vez

    def test_409_validado_se_confirma(self):
        r, cliente = self.importar((409, conflicto('validado')), (200, confirmacion()))
        self.assertEqual(r['resultado'], 'confirmado')
        self.assertEqual(cliente.peticiones[1][2], {'previewId': UUID})

    def test_409_con_errores_o_cargado_aborta(self):
        for estado in ('con_errores', 'cargado'):
            with self.subTest(estado=estado):
                cliente = ClienteFalso((409, conflicto(estado)))
                with self.assertRaisesRegex(carga.ErrorDeCarga, f'estado {estado}.*DELETE'):
                    self.datos.cargador(cliente).importar(self.entrada)
                self.assertEqual(len(cliente.peticiones), 1)  # nunca confirma

    def test_409_sin_id_es_error(self):
        otra_sesion = {'statusCode': 409, 'message': 'Este archivo ya se está cargando en otra sesión.'}
        with self.assertRaisesRegex(carga.ErrorDeCarga, '409 inesperado'):
            self.importar((409, otra_sesion))

    def test_filas_con_error_aborta(self):
        cliente = ClienteFalso((201, preview(filas_con_error=2)))
        with self.assertRaisesRegex(carga.ErrorDeCarga, '2 filas con error'):
            self.datos.cargador(cliente).importar(self.entrada)
        self.assertEqual(len(cliente.peticiones), 1)

    def test_confirmacion_incompleta_reintenta(self):
        r, cliente = self.importar((201, preview()), (200, confirmacion(False)), (200, confirmacion()))
        self.assertEqual(r['resultado'], 'confirmado')
        self.assertEqual(cliente.rutas().count('/v1/transactions/import/confirm'), 2)

    def test_confirmacion_que_nunca_completa_es_error(self):
        incompletas = [(200, confirmacion(False))] * carga.INTENTOS_CONFIRMACION
        with self.assertRaisesRegex(carga.ErrorDeCarga, 'sigue incompleta'):
            self.importar((201, preview()), *incompletas)

    def test_error_de_confirmacion_aborta(self):
        with self.assertRaisesRegex(carga.ErrorDeCarga, 'confirm ventas-0001.csv: respondió 503'):
            self.importar((201, preview()), (503, {'message': 'Base no disponible'}))

    def test_500_con_muchas_lineas_sugiere_el_tope(self):
        self.entrada['lineas'] = carga.LIMITE_LINEAS_CORE + 1
        with self.assertRaisesRegex(carga.ErrorDeCarga, '--max-lineas 4000'):
            self.importar((500, {'message': 'Internal server error'}))

    def test_500_con_pocas_lineas_no_culpa_al_tope(self):
        with self.assertRaises(carga.ErrorDeCarga) as e:
            self.importar((500, {'message': 'Internal server error'}))
        self.assertNotIn('--max-lineas', str(e.exception))
        self.assertIn('respondió 500', str(e.exception))

    def test_limite_igual_al_del_generador(self):
        self.assertEqual(carga.LIMITE_LINEAS_CORE, gen.LIMITE_LINEAS_CORE)


class VentasTest(unittest.TestCase):
    def test_segunda_corrida_no_duplica(self):
        datos = Datos(archivos=2)
        self.addCleanup(datos.tmp.cleanup)
        total = lambda n: (200, {'data': [], 'total': n})
        primera = ClienteFalso(total(100), (201, preview()), (200, confirmacion()),
                               (201, preview()), (200, confirmacion()), total(102))
        r = datos.cargador(primera).ventas()
        self.assertEqual((r['nuevas'], r['archivos']), (2, 2))
        # Segunda corrida: core-process reconoce los dos archivos (mismo SHA-256) como confirmados.
        segunda = ClienteFalso(total(102), (409, conflicto('confirmado')), (409, conflicto('confirmado')), total(102))
        cargador = datos.cargador(segunda)
        r = cargador.ventas()
        self.assertEqual(r['nuevas'], 0)
        self.assertEqual([a['resultado'] for a in cargador.registro['archivos']], ['ya cargado'] * 2)
        self.assertNotIn('/v1/transactions/import/confirm', segunda.rutas())


TIENDA, PRESENTACION = '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'
AHORA = datetime(2026, 11, 26, 18, 42, 7, tzinfo=timezone.utc)


def captura(status: str) -> dict:
    """Respuesta de availability-service (`captureResponse`)."""
    return {'captureId': UUID, 'status': status, 'storeId': TIENDA, 'presentationId': PRESENTACION}


class ExistenciasTest(unittest.TestCase):
    def setUp(self):
        self.datos = Datos()
        self.addCleanup(self.datos.tmp.cleanup)
        filas = [{'tienda': 'Tienda', 'sku': 'SKU', 'presentacion': '1 kg', 'stock': 0, 'haceHoras': 5},
                 {'tienda': 'Tienda', 'sku': 'SKU', 'presentacion': '500 g', 'stock': 12, 'haceHoras': 193}]
        contenido = json.dumps({'vigenciaHoras': 168, 'filas': filas}).encode()
        (self.datos.dir / 'existencias.json').write_bytes(contenido)
        manifiesto = json.loads((self.datos.dir / 'manifiesto.json').read_text())
        manifiesto['existencias'] = {'archivo': 'existencias.json', 'filas': 2,
                                     'sha256': hashlib.sha256(contenido).hexdigest()}
        (self.datos.dir / 'manifiesto.json').write_text(json.dumps(manifiesto))

    def cargar(self, *respuestas, ahora=AHORA):
        cliente = ClienteFalso(*respuestas)
        cargador = self.datos.cargador(cliente)
        cargador.tienda_id = {'Tienda': TIENDA}
        cargador.presentacion_id = {('SKU', '1 kg'): PRESENTACION, ('SKU', '500 g'): PRESENTACION}
        return cargador.existencias(ahora), cliente

    def test_envia_una_captura_por_fila(self):
        r, cliente = self.cargar((201, captura('aceptada')), (201, captura('aceptada')))
        self.assertEqual(r, {'aceptada': 2, 'conflicto': 0, 'duplicada': 0, 'filas': 2, 'dia': '2026-11-26'})
        self.assertEqual(cliente.rutas(), ['/v1/availability/captures'] * 2)
        cuerpo = cliente.peticiones[0][2]
        self.assertEqual(set(cuerpo), {'captureId', 'storeId', 'presentationId', 'stock', 'capturedAt', 'origin'})
        self.assertEqual((cuerpo['storeId'], cuerpo['stock'], cuerpo['origin']), (TIENDA, 0, 'movil'))
        self.assertEqual(cuerpo['capturedAt'], '2026-11-26T13:00:00.000Z')   # 18:00 en punto - 5 h
        # 193 h: más de 7 días -> availability-service lo marca vencido (control D-38).
        self.assertEqual(cliente.peticiones[1][2]['capturedAt'], '2026-11-18T17:00:00.000Z')

    def test_mismo_dia_mismo_id_otro_dia_otro(self):
        _, hoy = self.cargar((201, captura('aceptada')), (201, captura('aceptada')))
        _, mas_tarde = self.cargar((200, captura('duplicada')), (200, captura('duplicada')),
                                   ahora=AHORA.replace(hour=23, minute=59))
        _, manana = self.cargar((201, captura('aceptada')), (201, captura('aceptada')),
                                ahora=AHORA + timedelta(days=1))
        ids = lambda c: [p[2]['captureId'] for p in c.peticiones]
        self.assertEqual(ids(hoy), ids(mas_tarde))
        self.assertTrue(set(ids(hoy)).isdisjoint(ids(manana)))
        self.assertEqual(len(set(ids(hoy))), 2)   # una por presentación

    def test_segunda_corrida_del_dia_no_crea_nada(self):
        r, _ = self.cargar((200, captura('duplicada')), (200, captura('duplicada')))
        self.assertEqual((r['aceptada'], r['duplicada']), (0, 2))

    def test_capturado_en_nunca_en_el_futuro(self):
        for minuto in (0, 1, 59):
            ahora = AHORA.replace(minute=minuto, second=0)
            self.assertLess(datetime.fromisoformat(carga.capturado_en(ahora, 1).replace('Z', '+00:00')), ahora)
        with self.assertRaisesRegex(carga.ErrorDeCarga, 'haceHoras'):
            carga.capturado_en(AHORA, 0)

    def test_conflicto_se_cuenta_y_sigue(self):
        r, _ = self.cargar((201, captura('conflicto')), (201, captura('aceptada')))
        self.assertEqual((r['aceptada'], r['conflicto']), (1, 1))

    def test_409_aborta(self):
        with self.assertRaisesRegex(carga.ErrorDeCarga, 'respondió 409'):
            self.cargar((409, {'message': 'captureId ya usado por otro usuario'}))

    def test_403_explica_el_rol(self):
        with self.assertRaisesRegex(carga.ErrorDeCarga, 'Investigador de mercado'):
            self.cargar((403, {'message': 'Forbidden'}))

    def test_sha256_distinto_aborta_sin_enviar(self):
        (self.datos.dir / 'existencias.json').write_text('{"filas": []}')
        with self.assertRaisesRegex(carga.ErrorDeCarga, 'SHA-256'):
            self.cargar()

    def test_presentacion_sin_id_aborta_sin_enviar(self):
        cliente = ClienteFalso()
        cargador = self.datos.cargador(cliente)
        cargador.tienda_id = {'Tienda': TIENDA}
        with self.assertRaisesRegex(carga.ErrorDeCarga, 'no está en catalog-service'):
            cargador.existencias(AHORA)
        self.assertEqual(cliente.peticiones, [])

    def test_datos_sin_existencias_se_omiten(self):
        (self.datos.dir / 'manifiesto.json').write_text(json.dumps({'archivos': [], 'sha256': 'x'}))
        cliente = ClienteFalso()
        r = self.datos.cargador(cliente).existencias(AHORA)
        self.assertIn('omitido', r)
        self.assertEqual(cliente.peticiones, [])

    def test_con_el_archivo_del_generador(self):
        """Las filas reales del generador pasan las reglas del DTO de availability-service."""
        g = gen.Generador(6000, 52, date(2026, 11, 22), 4, 42)
        for f in gen.existencias(g):
            self.assertGreaterEqual(f['haceHoras'], 1)
            self.assertIsInstance(f['stock'], int)
            self.assertGreaterEqual(f['stock'], 0)


class ClienteTest(unittest.TestCase):
    def cliente(self, *respuestas):
        c = carga.Cliente({'auth': 'http://auth', 'core': 'http://core'}, {'analista': 'analista@retail.mx'},
                          'x', timeout=1)
        enviados = []

        def enviar(metodo, url, cuerpo, token, archivo=None):
            enviados.append((metodo, url, token))
            return respuestas[len(enviados) - 1]

        c._enviar = enviar
        return c, enviados

    def test_401_vuelve_a_entrar_una_vez(self):
        c, enviados = self.cliente((200, {'accessToken': 'A'}), (401, {}), (200, {'accessToken': 'B'}),
                                   (200, {'ok': True}))
        self.assertEqual(c.pedir('analista', 'GET', 'core', '/v1/transactions'), (200, {'ok': True}))
        self.assertEqual([e[2] for e in enviados if e[1] == 'http://core/v1/transactions'], ['A', 'B'])

    def test_401_repetido_no_cicla(self):
        c, enviados = self.cliente((200, {'accessToken': 'A'}), (401, {}), (200, {'accessToken': 'B'}), (401, {}))
        self.assertEqual(c.pedir('analista', 'GET', 'core', '/v1/x')[0], 401)
        self.assertEqual(len(enviados), 4)

    def test_login_fallido_es_error(self):
        c, _ = self.cliente((401, {'message': 'Credenciales inválidas'}))
        with self.assertRaisesRegex(carga.ErrorDeCarga, 'No se pudo entrar como analista'):
            c.pedir('analista', 'GET', 'core', '/v1/x')

    def test_todas_recorre_las_paginas(self):
        c = carga.Cliente({}, {}, 'x', timeout=1)
        paginas = {1: list(range(100)), 2: list(range(100, 200)), 3: [200, 201]}
        rutas = []

        def pedir(rol, metodo, servicio, ruta, cuerpo=None, archivo=None):
            rutas.append(ruta)
            pagina = int(ruta.rsplit('page=', 1)[1])
            return 200, {'data': paginas[pagina], 'total': 202}

        c.pedir = pedir
        self.assertEqual(c.todas('admin', 'catalog', '/v1/zones'), list(range(202)))
        self.assertEqual(rutas[0], '/v1/zones?limit=100&page=1')
        self.assertEqual(len(rutas), 3)


if __name__ == '__main__':
    unittest.main()
