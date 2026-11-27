"""Pruebas del escenario de carga, sin red ni Locust.

    python -m unittest discover -s carga/tests -v
"""
import random
import sys
import unittest
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import escenario as esc  # noqa: E402

FX = esc.Fixtures(
    zonas=[{'id': str(uuid.uuid4()), 'nombre': 'Zona Centro', 'segmentId': 2},
           {'id': str(uuid.uuid4()), 'nombre': 'Zona Norte', 'segmentId': None}],
    tiendas=[{'id': str(uuid.uuid4()), 'zonaId': None} for _ in range(3)],
    productos=[{'id': str(uuid.uuid4()), 'sku': 'GEN-ARR-1KG', 'presentaciones': [str(uuid.uuid4()), str(uuid.uuid4())]}],
    recomendacion=str(uuid.uuid4()), responsable=str(uuid.uuid4()))
AHORA = datetime(2026, 11, 27, 18, 0, tzinfo=timezone.utc)


class FormaTest(unittest.TestCase):
    def test_etapas_de_la_guia(self):
        self.assertEqual([e.usuarios for e in esc.ETAPAS], [5, 10, 25, 50, 60, 10])
        self.assertEqual(esc.duracion(), 780)

    def test_etapa_en_cada_frontera(self):
        self.assertEqual(esc.etapa_en(0)[1], 5)
        self.assertEqual(esc.etapa_en(59.9)[1], 5)
        self.assertEqual(esc.etapa_en(60)[1], 10)
        self.assertEqual(esc.etapa_en(600)[0].nombre, 'pico')
        self.assertEqual(esc.etapa_en(779)[1], 10)
        self.assertIsNone(esc.etapa_en(780))

    def test_escala_nunca_baja_de_un_usuario(self):
        self.assertEqual(esc.etapa_en(0, escala=0.1)[1], 1)
        self.assertEqual(esc.etapa_en(600, escala=0.2)[1], 12)

    def test_sesiones_para_el_pico(self):
        self.assertEqual(esc.sesiones_necesarias(), 12)          # 60 / 5 perfiles
        self.assertEqual(esc.sesiones_necesarias(escala=0.2), 3)  # 12 / 5 -> 3


class ClasificarTest(unittest.TestCase):
    def test_429_aparte(self):
        self.assertEqual(esc.clasificar(200), 'ok')
        self.assertEqual(esc.clasificar(429), 'limitado')
        self.assertEqual(esc.clasificar(503), 'falla')
        self.assertEqual(esc.clasificar(401), 'falla')

    def test_esperados_por_ruta(self):
        self.assertEqual(esc.clasificar(422, (201, 422)), 'ok')   # pronóstico con poca historia
        self.assertEqual(esc.clasificar(200, (201,)), 'falla')


class EscriturasTest(unittest.TestCase):
    def test_lote_cumple_el_contrato_de_offline_sync(self):
        lote = esc.lote_sync(FX, random.Random(1), str(uuid.uuid4()), AHORA)
        self.assertEqual(set(lote), {'batchId', 'deviceId', 'contractVersion', 'client', 'sentAt', 'captures'})
        self.assertEqual((lote['contractVersion'], lote['client']), ('1.0', 'movil'))
        self.assertEqual(len(lote['captures']), esc.CAPTURAS_POR_LOTE)
        self.assertEqual(len({c['captureId'] for c in lote['captures']}), esc.CAPTURAS_POR_LOTE)
        for c in lote['captures']:
            self.assertEqual(set(c), {'captureId', 'type', 'contractVersion', 'capturedAt', 'storeId',
                                      'presentationId', 'content'})
            cuando = datetime.fromisoformat(c['capturedAt'])
            self.assertIsNotNone(cuando.tzinfo)        # el contrato exige zona horaria
            self.assertLessEqual(cuando, AHORA)        # nunca en el futuro
            if c['type'] == 'disponibilidad':
                self.assertGreaterEqual(c['content']['stock'], 0)
            else:
                self.assertGreater(c['content']['price'], 0)

    def test_disponibilidad_vieja_no_pisa_los_controles(self):
        """30 días atrás: más vieja que la del cargador (conflicto, D-42) y vencida (D-38, > 7 días)."""
        lote = esc.lote_sync(FX, random.Random(2), 'x', AHORA)
        for c in lote['captures']:
            if c['type'] == 'disponibilidad':
                self.assertGreater(AHORA - datetime.fromisoformat(c['capturedAt']), timedelta(days=7))

    def test_lotes_distintos_cada_vez(self):
        a, b = (esc.lote_sync(FX, random.Random(3), 'x', AHORA) for _ in range(2))
        self.assertNotEqual(a['batchId'], b['batchId'])

    def test_promocion_valida(self):
        p = esc.promocion(FX, random.Random(4), 'humo', hoy=date(2026, 11, 27))
        self.assertTrue(p['name'].startswith('carga-humo-'))
        self.assertEqual(p['validFrom'], '2026-11-28')      # validFrom >= hoy (§5)
        self.assertGreater(p['validTo'], p['validFrom'])
        self.assertTrue(5 <= p['discountPct'] <= 30)
        self.assertIn(p['presentationId'], FX.productos[0]['presentaciones'])
        self.assertNotIn('storeId', p)                       # exactamente uno: zona

    def test_asignacion_sin_recomendacion_se_salta(self):
        self.assertIsNone(esc.asignacion(esc.Fixtures(FX.zonas, FX.tiendas, FX.productos)))
        self.assertEqual(esc.asignacion(FX)['recommendationId'], FX.recomendacion)


class LecturasTest(unittest.TestCase):
    def test_cinco_perfiles_con_lecturas_y_escrituras_declaradas(self):
        self.assertEqual(set(esc.LECTURAS), {'catalogo', 'investigador', 'analista', 'gerente', 'administrador'})
        self.assertEqual(set(esc.ESCRITURAS), set(esc.LECTURAS))

    def test_rutas_sin_huecos(self):
        rng = random.Random(5)
        for perfil, lecturas in esc.LECTURAS.items():
            for l in lecturas:
                ruta = l.ruta(FX, rng)
                self.assertTrue(ruta.startswith('/v1/'), (perfil, ruta))
                self.assertNotIn('None', ruta, (perfil, ruta))
                self.assertNotIn(':id', ruta, (perfil, ruta))

    def test_grupo_de_canasta_solo_con_zonas_clasificadas(self):
        """typical-basket exige zoneId y segmentId (contrato): nunca se pide una zona sin segmento."""
        rng = random.Random(6)
        for _ in range(20):
            self.assertIn(f"zoneId={FX.zonas[0]['id']}&segmentId=2", esc._grupo(FX, rng))

    def test_acciones_con_y_sin_escrituras(self):
        self.assertEqual(esc.acciones('gerente', False), (['leer', 'proponer_promocion', 'asignar'], [9, 2, 1]))
        self.assertEqual(esc.acciones('gerente', True), (['leer'], [9]))
        self.assertEqual(esc.acciones('administrador', False)[0], ['leer'])

    def test_servicios_caidos_se_saltan(self):
        """--saltar-caidos: ni lecturas ni escrituras a un servicio que no respondió al arrancar."""
        caidos = frozenset({'documents-service', 'recommendations-workflow-service'})
        nombres, pesos = esc.acciones('gerente', False, caidos)
        self.assertEqual((nombres, pesos), (['leer', 'proponer_promocion'], [7, 2]))
        rng = random.Random(8)
        for _ in range(50):
            self.assertNotEqual(esc.elegir_lectura('gerente', rng, caidos).servicio, 'documents-service')
        todos = frozenset(l.servicio for l in esc.LECTURAS['investigador']) | {'offline-sync-service'}
        self.assertEqual(esc.acciones('investigador', False, todos), ([], []))
        self.assertIsNone(esc.elegir_lectura('investigador', rng, todos))

    def test_servicios_usados_existen(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from destinos import PUERTOS
        self.assertLessEqual(esc.servicios_usados(), set(PUERTOS))
        self.assertEqual(esc.servicios_usados(), set(PUERTOS))   # los 20 microservicios reciben carga

    def test_proporcion_xml(self):
        rng = random.Random(7)
        xml = sum(esc.quiere_xml(rng) for _ in range(5000)) / 5000
        self.assertAlmostEqual(xml, esc.PROPORCION_XML, delta=0.03)


def acuse_de(lote: dict, estados: list[str]) -> dict:
    """Acuse como lo devuelve offline-sync (contrato §4.5)."""
    return {'batchId': lote['batchId'], 'summary': {'total': len(lote['captures'])},
            'results': [{'captureId': c['captureId'], 'type': c['type'], 'status': e,
                         'reason': None if e != 'rechazada' else {'code': 'FORBIDDEN'}, 'retryable': False}
                        for c, e in zip(lote['captures'], estados)]}


class ValidacionTest(unittest.TestCase):
    def setUp(self):
        self.lote = esc.lote_sync(FX, random.Random(9), 'x', AHORA)
        self.tipos = [c['type'] for c in self.lote['captures']]

    def test_acuse_correcto(self):
        estados = ['conflicto' if t == 'disponibilidad' else 'aceptada' for t in self.tipos]
        self.assertIsNone(esc.validar_acuse(self.lote, acuse_de(self.lote, estados)))
        self.assertIsNone(esc.validar_acuse(self.lote, acuse_de(self.lote, ['aceptada'] * 5)))
        # D-42 también en pricing: un precio observado con otro más reciente ya registrado.
        self.assertIsNone(esc.validar_acuse(self.lote, acuse_de(self.lote, ['conflicto'] * 5)))
        self.assertIn('duplicada', esc.validar_acuse(self.lote, acuse_de(self.lote, ['duplicada'] * 5)))

    def test_acuse_con_rechazo_es_falla_de_negocio(self):
        estados = ['aceptada'] * 5
        estados[1] = 'rechazada'
        self.assertIn('rechazada (FORBIDDEN', esc.validar_acuse(self.lote, acuse_de(self.lote, estados)))

    def test_acuse_incompleto_o_desordenado(self):
        acuse = acuse_de(self.lote, ['aceptada'] * 5)
        acuse['results'] = acuse['results'][::-1]
        self.assertIn('orden del lote', esc.validar_acuse(self.lote, acuse))
        acuse = acuse_de(self.lote, ['aceptada'] * 5)
        acuse['summary']['total'] = 4
        self.assertIn('summary.total', esc.validar_acuse(self.lote, acuse))
        self.assertEqual(esc.validar_acuse(self.lote, {**acuse, 'batchId': 'otro'}), 'acuse de otro lote')

    def test_propiedad(self):
        self.assertIsNone(esc.validar_lote_propio('b1', {'batchId': 'b1'}))
        self.assertIsNotNone(esc.validar_lote_propio('b1', {'batchId': 'b2'}))
        self.assertIsNone(esc.validar_no_encontrado({'statusCode': 404, 'code': 'NOT_FOUND'}))
        self.assertIsNotNone(esc.validar_no_encontrado({'statusCode': 404}))

    def test_disponible_false_nunca_con_valor(self):
        """D-20: no disponible sale con motivo y SIN el valor; un 0 es falla de negocio."""
        self.assertIsNone(esc.validar_disponible({'disponible': True, 'coverage': 77.78}, 'coverage'))
        self.assertIsNone(esc.validar_disponible({'disponible': False, 'motivo': 'Sin datos vigentes.'}, 'coverage'))
        self.assertIn('D-20', esc.validar_disponible({'disponible': False, 'motivo': 'x', 'coverage': 0}, 'coverage'))
        self.assertIn('sin `motivo`', esc.validar_disponible({'disponible': False}, 'coverage'))
        self.assertIn('sin `coverage`', esc.validar_disponible({'disponible': True}, 'coverage'))
        self.assertIn('falta', esc.validar_disponible({'coverage': 50}))

    def test_promocion(self):
        enviada = esc.promocion(FX, random.Random(10), 'humo', hoy=date(2026, 11, 27))
        creada = {**enviada, 'id': 'p1', 'status': 'pendiente'}
        self.assertIsNone(esc.validar_promocion(enviada, creada, 'pendiente'))
        self.assertIn('`aprobada`', esc.validar_promocion(enviada, creada, 'aprobada'))
        self.assertIn('`zoneId`', esc.validar_promocion(enviada, {**creada, 'zoneId': 'otra'}, 'pendiente'))
        aprobada = {'id': 'p1', 'status': 'aprobada', 'resolvedBy': 'u', 'resolvedAt': '2026-11-27T10:00:00Z'}
        self.assertIsNone(esc.validar_promocion({}, aprobada, 'aprobada'))
        self.assertIn('resolvedBy', esc.validar_promocion({}, {**aprobada, 'resolvedBy': None}, 'aprobada'))

    def test_asignacion(self):
        enviada = esc.asignacion(FX)
        ok = {'recommendationId': FX.recomendacion, 'assigneeUserId': FX.responsable, 'status': 'asignada'}
        self.assertIsNone(esc.validar_asignacion(enviada, ok))
        self.assertIsNone(esc.validar_asignacion(enviada, {**ok, 'status': 'evaluada'}))  # reintento: estado actual
        self.assertIn('responsable', esc.validar_asignacion(enviada, {**ok, 'assigneeUserId': 'otro'}))
        self.assertIn('desconocido', esc.validar_asignacion(enviada, {**ok, 'status': 'cancelada'}))

    def test_pronostico(self):
        self.assertIsNone(esc.validar_pronostico(201, {'id': 'r1', 'disponible': True}))
        self.assertIsNone(esc.validar_pronostico(201, {'id': 'r1', 'disponible': False, 'motivo': 'D-36'}))
        self.assertIsNone(esc.validar_pronostico(422, {'statusCode': 422, 'code': 'INSUFFICIENT_HISTORY'}))
        self.assertIsNotNone(esc.validar_pronostico(422, {'message': 'x'}))
        self.assertIsNotNone(esc.validar_pronostico(201, {'disponible': True}))

    def test_lecturas_especificas_y_listados(self):
        zona = FX.zonas[0]['id']
        acc = next(l for l in esc.LECTURAS['gerente'] if l.plantilla == '/v1/accessibility/by-zone/:id')
        ruta = f'/v1/accessibility/by-zone/{zona}'
        self.assertIsNone(esc.validar_lectura(acc, {'zoneId': zona, 'indexValue': 0.6}, ruta))
        self.assertIn('otra zona', esc.validar_lectura(acc, {'zoneId': 'otra'}, ruta))
        lista = esc.LECTURAS['catalogo'][0]
        self.assertIsNone(esc.validar_lectura(lista, {'data': [1, 2], 'total': 10}, '/v1/products'))
        self.assertIn('`total`', esc.validar_lectura(lista, {'data': [1, 2], 'total': 1}, '/v1/products'))
        self.assertIn('arreglo', esc.validar_lectura(lista, {'data': {}, 'total': 1}, '/v1/products'))
        canasta = next(l for l in esc.LECTURAS['analista'] if l.plantilla == '/v1/typical-basket')
        self.assertIn('group', esc.validar_lectura(canasta, {'disponible': True}, '/v1/typical-basket'))

    def test_xml(self):
        self.assertIsNone(esc.validar_xml('<?xml version="1.0"?><stockListResponse xmlns="availability/v1"/>'))
        self.assertIn('error', esc.validar_xml('<error xmlns="x"><statusCode>500</statusCode></error>'))
        self.assertIn('mal formado', esc.validar_xml('<a><b></a>'))
        # Un 404 esperado (sonda de transactions-ingestion, propiedad) en XML ES un <error>.
        self.assertIsNone(esc.validar_xml('<error xmlns="x"><statusCode>404</statusCode></error>', error_esperado=True))
        self.assertIn('se esperaba', esc.validar_xml('<stockListResponse/>', error_esperado=True))

    def test_propiedad_es_accion_del_investigador(self):
        self.assertEqual(esc.acciones('investigador', False), (['leer', 'lote_sync', 'propiedad'], [7, 3, 1]))


if __name__ == '__main__':
    unittest.main()
