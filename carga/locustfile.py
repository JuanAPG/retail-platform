"""Prueba de carga del Parcial 3: 5 perfiles con sesiones reales contra los 20 microservicios.

Antes (una vez por ambiente; ver carga/README.md):
    python carga/usuarios_carga.py --por-perfil 12      # cuentas sintéticas por rol
    python carga/sesiones.py --por-perfil 12            # logins a ≤ 14/min -> .sesiones.json
    python carga/preparar.py                            # ids del ambiente -> .fixtures.json

Correr (la forma 5 → 10 → 25 → 50 → pico 60 → 10 dura 13 min):
    locust -f carga/locustfile.py --headless --csv carga/resultados/<corrida> --corrida <corrida>
    ... --escala 0.2 --escala-tiempo 0.1      # humo: 1–12 usuarios, ~1.3 min
    ... --solo-lectura                        # sin escrituras
    ... --saltar-caidos                       # humo local: sin tareas para servicios que no responden

El destino (local por puertos, o `<base>/api/<servicio>`) sale de `.sesiones.json`: las sesiones se
abrieron contra ese ambiente. No hay login durante la medición (auth limita a 15 por minuto); cada
usuario virtual toma una sesión propia y la renueva con `/v1/auth/refresh` antes de que venza.
Los 429 se cuentan aparte (tipo `LIMITADO`), no como falla.
"""
from __future__ import annotations

import json
import random
import sys
import threading
import uuid
from collections import deque
from pathlib import Path

from locust import HttpUser, LoadTestShape, between, events, task

sys.path.insert(0, str(Path(__file__).resolve().parent))
import escenario as esc  # noqa: E402
import sesiones as ses  # noqa: E402
from destinos import Destino, Http  # noqa: E402

AQUI = Path(__file__).resolve().parent
ESTADO: dict = {'destino': None, 'fixtures': None, 'pool': {}, 'corrida': None, 'solo_lectura': False,
          'caidos': frozenset()}
CANDADO = threading.Lock()
PENDIENTES: deque[str] = deque(maxlen=2000)
SIN_SESION: dict[str, int] = {}               # usuarios que quedaron inactivos por falta de sesión   # promociones que propuso el Gerente, para que las apruebe precios


@events.init_command_line_parser.add_listener
def _opciones(parser):
    parser.add_argument('--corrida', default=None, help='Etiqueta de la corrida (va en X-Correlation-Id).')
    parser.add_argument('--solo-lectura', action='store_true', help='Sin escrituras.')
    parser.add_argument('--escala', type=float, default=1.0, help='Multiplica los usuarios de cada etapa.')
    parser.add_argument('--escala-tiempo', type=float, default=1.0, help='Multiplica la duración de cada etapa.')
    parser.add_argument('--saltar-caidos', action='store_true',
                        help='No manda tareas a los servicios cuyo /v1/health no responde al arrancar. Solo para '
                             'el humo local: en Windows, cada intento contra un puerto cerrado traba a gevent '
                             'varios segundos y ensucia los tiempos de todos.')
    parser.add_argument('--sesiones', default=str(AQUI / '.sesiones.json'))
    parser.add_argument('--fixtures', default=str(AQUI / '.fixtures.json'))


@events.init.add_listener
def _iniciar(environment, **_):
    o = environment.parsed_options
    if o is None:   # importado sin la CLI (p. ej. en pruebas)
        return
    datos = ses.cargar(Path(o.sesiones))
    ESTADO['destino'] = Destino(datos.get('base'))
    ESTADO['fixtures'] = esc.Fixtures.desde(json.loads(Path(o.fixtures).read_text(encoding='utf-8')))
    ESTADO['corrida'] = o.corrida or uuid.uuid4().hex[:8]
    ESTADO['solo_lectura'] = o.solo_lectura
    pool: dict[str, list] = {}
    for s in datos['sesiones']:
        pool.setdefault(s['perfil'], []).append(s)
    ESTADO['pool'] = pool
    http = Http(timeout=3)
    caidos = sorted(s for s in esc.servicios_usados() if not _responde(http, ESTADO['destino'].url(s, '/v1/health')))
    if caidos:
        accion = 'se saltan sus tareas' if o.saltar_caidos else 'sus peticiones contarán como falla'
        print(f'  AVISO: no responden {caidos}: {accion}.')
    if o.saltar_caidos:
        ESTADO['caidos'] = frozenset(caidos)
    necesarias = esc.sesiones_necesarias(escala=o.escala)
    cortos = {p: len(pool.get(p, [])) for p in esc.LECTURAS if len(pool.get(p, [])) < necesarias}
    print(f"Carga '{ESTADO['corrida']}' contra {ESTADO['destino']}; sesiones por perfil "
          f"{ {p: len(v) for p, v in pool.items()} }; el pico necesita {necesarias} por perfil.")
    if cortos:
        print(f'  AVISO: perfiles con menos sesiones que el pico {cortos}: esos usuarios extra no arrancan.')


def _responde(http: Http, url: str) -> bool:
    """`/v1/health` con 200; conexión rechazada o timeout cuentan como caído."""
    try:
        return http.pedir('GET', url)[0] == 200
    except OSError:   # URLError, ConnectionRefusedError, TimeoutError
        return False


class Perfil(HttpUser):
    abstract = True
    perfil = ''
    wait_time = between(1, 3)
    host = 'http://localhost'   # se ignora: cada petición va con URL absoluta al servicio

    def on_start(self):
        self.sesion = None
        self.acciones, self.pesos = esc.acciones(self.perfil, ESTADO['solo_lectura'], ESTADO['caidos'])
        if not self.acciones:   # todos sus servicios caídos con --saltar-caidos: usuario inactivo
            return
        with CANDADO:
            disponibles = ESTADO['pool'].get(self.perfil, [])
            if not disponibles:
                # Más usuarios que sesiones de este perfil: queda inactivo (sin peticiones). Se avisa al arrancar.
                SIN_SESION[self.perfil] = SIN_SESION.get(self.perfil, 0) + 1
                return
            self.sesion = disponibles.pop()
        self.rng = random.Random()
        self.dispositivo = str(uuid.uuid5(uuid.NAMESPACE_URL, self.sesion['email']))

    def on_stop(self):
        if getattr(self, 'sesion', None):
            with CANDADO:
                ESTADO['pool'].setdefault(self.perfil, []).append(self.sesion)

    # --- HTTP

    def _renovar_si_hace_falta(self):
        if not ses.necesita_renovar(self.sesion):
            return
        url = ESTADO['destino'].url('auth-service', '/v1/auth/refresh')
        with self.client.post(url, json={'refreshToken': self.sesion['refreshToken']},
                              name='auth-service /v1/auth/refresh', catch_response=True) as r:
            if r.status_code == 200:
                cuerpo = r.json()
                self.sesion = {**self.sesion, 'accessToken': cuerpo['accessToken'],
                               'refreshToken': cuerpo['refreshToken']}
                r.success()
            else:
                r.failure(f'{r.status_code}: {r.text[:200]}')

    def pedir(self, metodo: str, servicio: str, ruta: str, nombre: str, cuerpo=None,
              esperados: tuple[int, ...] = (200,), xml: bool = False):
        self._renovar_si_hace_falta()
        cabeceras = {'Authorization': f"Bearer {self.sesion['accessToken']}",
                     'X-Correlation-Id': esc.correlacion(ESTADO['corrida']),
                     'Accept': 'application/xml' if xml else 'application/json'}
        etiqueta = f"{servicio} {nombre}{' [xml]' if xml else ''}"
        with self.client.request(metodo, ESTADO['destino'].url(servicio, ruta), json=cuerpo, headers=cabeceras,
                                 name=etiqueta, catch_response=True) as r:
            clase = esc.clasificar(r.status_code, esperados)
            if clase == 'ok':
                r.success()
            elif clase == 'limitado':
                r.success()
                self.environment.events.request.fire(
                    request_type='LIMITADO', name=etiqueta, response_time=r.elapsed.total_seconds() * 1000,
                    response_length=len(r.content or b''), exception=None, context={})
            else:
                r.failure(f'{r.status_code}: {r.text[:200]}')
            return r

    # --- lo que hace cada iteración

    @task
    def paso(self):
        if self.sesion is None:
            return
        accion = self.rng.choices(self.acciones, weights=self.pesos)[0]
        getattr(self, accion)()

    def leer(self):
        lectura = esc.elegir_lectura(self.perfil, self.rng, ESTADO['caidos'])
        if lectura is None:
            return
        self.pedir('GET', lectura.servicio, lectura.ruta(ESTADO['fixtures'], self.rng), lectura.plantilla,
                   esperados=lectura.esperados, xml=esc.quiere_xml(self.rng))

    def lote_sync(self):
        self.pedir('POST', 'offline-sync-service', '/v1/sync/batches', '/v1/sync/batches',
                   esc.lote_sync(ESTADO['fixtures'], self.rng, self.dispositivo))

    def pronostico(self):
        fx = ESTADO['fixtures']
        cuerpo = {'productId': self.rng.choice(fx.productos)['id'], 'zoneId': self.rng.choice(fx.zonas)['id']}
        # 422 es una respuesta de negocio válida (menos de 12 semanas, unidades mezcladas, D-40/DF-2).
        self.pedir('POST', 'demand-forecast-service', '/v1/forecast/run', '/v1/forecast/run', cuerpo,
                   esperados=(201, 422))

    def proponer_promocion(self):
        r = self.pedir('POST', 'promotion-service', '/v1/promotions', '/v1/promotions',
                       esc.promocion(ESTADO['fixtures'], self.rng, ESTADO['corrida']), esperados=(201,))
        if r.status_code == 201:
            PENDIENTES.append(r.json()['id'])

    def aprobar_promocion(self):
        try:
            pid = PENDIENTES.popleft()
        except IndexError:
            return self.leer()
        self.pedir('PATCH', 'promotion-service', f'/v1/promotions/{pid}/approve', '/v1/promotions/:id/approve')

    def asignar(self):
        cuerpo = esc.asignacion(ESTADO['fixtures'])
        if cuerpo is None:
            return self.leer()
        self.pedir('POST', 'recommendations-workflow-service', '/v1/workflow/assignments',
                   '/v1/workflow/assignments', cuerpo, esperados=(200, 201))


class Catalogo(Perfil):
    perfil = 'catalogo'


class Investigador(Perfil):
    perfil = 'investigador'


class Analista(Perfil):
    perfil = 'analista'


class Gerente(Perfil):
    perfil = 'gerente'


class Administrador(Perfil):
    perfil = 'administrador'


@events.quitting.add_listener
def _al_terminar(environment, **_):
    if SIN_SESION:
        print(f'AVISO: usuarios que arrancaron sin sesión y quedaron inactivos, por perfil: {SIN_SESION}. '
              'Abre más con sesiones.py --por-perfil.')


class Forma(LoadTestShape):
    """5 → 10 → 25 → 50 → pico 60 → 10 (`escenario.ETAPAS`), escalable desde la línea de comandos."""

    def tick(self):
        o = self.runner.environment.parsed_options
        escala_t = getattr(o, 'escala_tiempo', 1.0) or 1.0
        actual = esc.etapa_en(self.get_run_time() / escala_t, escala=getattr(o, 'escala', 1.0) or 1.0)
        if actual is None:
            return None
        etapa, usuarios = actual
        return usuarios, etapa.ritmo
