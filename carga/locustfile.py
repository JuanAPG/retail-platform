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
Los 429 se cuentan aparte (tipo `LIMITADO`), no como falla. Además del código HTTP se valida la
respuesta de negocio (acuses, estados, propiedad, `disponible:false` sin valor): un 200 con cuerpo
incorrecto es falla con el prefijo `NEGOCIO`, que se separa de las fallas HTTP en `*_failures.csv`.
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
RENOVADAS: dict[str, dict] = {}              # correo -> sesión con los tokens que rotó /v1/auth/refresh
LOTES: dict[str, str] = {}                   # correo del investigador -> su último lote (para la propiedad)
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
    ESTADO['archivo_sesiones'] = Path(o.sesiones)
    ESTADO['datos_sesiones'] = datos
    pool: dict[str, list] = {}
    for s in datos['sesiones']:
        pool.setdefault(s['perfil'], []).append(s)
    ESTADO['pool'] = pool
    caidos = _servicios_caidos(Http(timeout=5), pool)
    if caidos is None:
        print('  AVISO: no se pudo revisar el estado de los servicios (sin sesión de administrador).')
        caidos = []
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


def _servicios_caidos(http: Http, pool: dict) -> list[str] | None:
    """Local: el `/v1/health` de cada servicio. Detrás del proxy `/v1/health` no se publica
    (`routes.caddy`, `@interno`): se pregunta a monitoring-service con una sesión de administrador."""
    destino = ESTADO['destino']
    if destino.base is None:
        return sorted(s for s in esc.servicios_usados() if not _responde(http, destino.url(s, '/v1/health')))
    admin = (pool.get('administrador') or [None])[0]
    if admin is None:
        return None
    try:
        estado, cuerpo, _ = http.pedir('GET', destino.url('monitoring-service', '/v1/monitoring/services'),
                                       token=admin['accessToken'])
    except OSError:
        return None
    if estado != 200:
        return None
    operativos = {f['service'] for f in cuerpo.get('data', []) if f.get('status') == 'operativo'}
    return sorted(esc.servicios_usados() - operativos)


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
                with CANDADO:
                    RENOVADAS[self.sesion['email']] = self.sesion
                r.success()
            else:
                r.failure(f'{r.status_code}: {r.text[:200]}')

    def pedir(self, metodo: str, servicio: str, ruta: str, nombre: str, cuerpo=None,
              esperados: tuple[int, ...] = (200,), xml: bool = False, validar=None):
        """Devuelve (status, cuerpo JSON o None). `validar(status, cuerpo)` revisa el negocio cuando el
        código fue el esperado; si devuelve un problema, la petición cuenta como falla NEGOCIO."""
        self._renovar_si_hace_falta()
        cabeceras = {'Authorization': f"Bearer {self.sesion['accessToken']}",
                     'X-Correlation-Id': esc.correlacion(ESTADO['corrida']),
                     'Accept': 'application/xml' if xml else 'application/json'}
        etiqueta = f"{servicio} {nombre}{' [xml]' if xml else ''}"
        with self.client.request(metodo, ESTADO['destino'].url(servicio, ruta), json=cuerpo, headers=cabeceras,
                                 name=etiqueta, catch_response=True) as r:
            clase = esc.clasificar(r.status_code, esperados)
            datos = None
            if clase == 'ok':
                if xml:
                    problema = esc.validar_xml(r.text)
                else:
                    try:
                        datos = r.json() if r.content else None
                        problema = validar(r.status_code, datos) if validar else None
                    except ValueError:
                        problema = 'cuerpo que no es JSON'
                if problema:
                    r.failure(f'{esc.PREFIJO_NEGOCIO}: {problema}')
                else:
                    r.success()
            elif clase == 'limitado':
                r.success()
                self.environment.events.request.fire(
                    request_type='LIMITADO', name=etiqueta, response_time=r.elapsed.total_seconds() * 1000,
                    response_length=len(r.content or b''), exception=None, context={})
            else:
                r.failure(f'{r.status_code}: {r.text[:200]}')
            return r.status_code, datos

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
        ruta = lectura.ruta(ESTADO['fixtures'], self.rng)
        self.pedir('GET', lectura.servicio, ruta, lectura.plantilla, esperados=lectura.esperados,
                   xml=esc.quiere_xml(self.rng), validar=lambda st, c: esc.validar_lectura(lectura, c, ruta))

    def lote_sync(self):
        lote = esc.lote_sync(ESTADO['fixtures'], self.rng, self.dispositivo)
        estado, _ = self.pedir('POST', 'offline-sync-service', '/v1/sync/batches', '/v1/sync/batches', lote,
                               validar=lambda st, c: esc.validar_acuse(lote, c))
        if estado == 200:
            LOTES[self.sesion['email']] = lote['batchId']

    def propiedad(self):
        """El autor ve su lote (200) y el de otro investigador no (404, mismo cuerpo que inexistente)."""
        propio = LOTES.get(self.sesion['email'])
        ajenos = [b for correo, b in LOTES.items() if correo != self.sesion['email']]
        if not propio:
            return self.lote_sync()
        self.pedir('GET', 'offline-sync-service', f'/v1/sync/batches/{propio}', '/v1/sync/batches/:id (propio)',
                   validar=lambda st, c: esc.validar_lote_propio(propio, c))
        if ajenos:
            self.pedir('GET', 'offline-sync-service', f'/v1/sync/batches/{self.rng.choice(ajenos)}',
                       '/v1/sync/batches/:id (ajeno, 404)', esperados=(404,),
                       validar=lambda st, c: esc.validar_no_encontrado(c))

    def pronostico(self):
        fx = ESTADO['fixtures']
        cuerpo = {'productId': self.rng.choice(fx.productos)['id'], 'zoneId': self.rng.choice(fx.zonas)['id']}
        # 422 es una respuesta de negocio válida (menos de 12 semanas, unidades mezcladas, D-40/DF-2).
        self.pedir('POST', 'demand-forecast-service', '/v1/forecast/run', '/v1/forecast/run', cuerpo,
                   esperados=(201, 422), validar=esc.validar_pronostico)

    def proponer_promocion(self):
        enviada = esc.promocion(ESTADO['fixtures'], self.rng, ESTADO['corrida'])
        estado, datos = self.pedir('POST', 'promotion-service', '/v1/promotions', '/v1/promotions', enviada,
                                   esperados=(201,), validar=lambda st, c: esc.validar_promocion(enviada, c, 'pendiente'))
        if estado == 201 and datos and datos.get('id'):
            PENDIENTES.append(datos['id'])

    def aprobar_promocion(self):
        try:
            pid = PENDIENTES.popleft()
        except IndexError:
            return self.leer()
        self.pedir('PATCH', 'promotion-service', f'/v1/promotions/{pid}/approve', '/v1/promotions/:id/approve',
                   validar=lambda st, c: esc.validar_promocion({}, c, 'aprobada') or (
                       None if c.get('id') == pid else 'aprobó otra promoción'))

    def asignar(self):
        cuerpo = esc.asignacion(ESTADO['fixtures'])
        if cuerpo is None:
            return self.leer()
        self.pedir('POST', 'recommendations-workflow-service', '/v1/workflow/assignments',
                   '/v1/workflow/assignments', cuerpo, esperados=(200, 201),
                   validar=lambda st, c: esc.validar_asignacion(cuerpo, c))


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
    # El refresh ROTA el refresh token: sin guardar las sesiones renovadas, la siguiente corrida
    # arrancaría con tokens ya usados (401 en todo).
    if RENOVADAS and ESTADO.get('archivo_sesiones'):
        datos = ESTADO['datos_sesiones']
        sesiones = [RENOVADAS.get(s['email'], s) for s in datos['sesiones']]
        ESTADO['archivo_sesiones'].write_text(json.dumps({**datos, 'sesiones': sesiones}, ensure_ascii=False, indent=1),
                                              encoding='utf-8')
        print(f'Sesiones renovadas guardadas en {ESTADO["archivo_sesiones"].name}: {len(RENOVADAS)}.')
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
