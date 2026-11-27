"""Qué hace cada perfil en la carga: rutas, pesos, cuerpos de escritura y forma de la carga.

Sin Locust ni red: lo usa `locustfile.py` y se prueba solo (`carga/tests/test_escenario.py`).

Reglas para no ensuciar los datos de la demo (los controles del generador, db/README-generador.md):
- Las capturas de **disponibilidad** de los lotes van fechadas hace 30 días. availability-service las
  guarda en su bitácora como `conflicto` (D-42: el dato vigente del cargador es más reciente) y no
  cambian la cobertura de control. Las de **precio observado** nacen pendientes de aprobación.
- Las promociones nacen `pendiente` con nombre `carga-<corrida>-…`; D-39 no anexa nada a `precios`.
- La asignación de seguimiento se repite sobre la misma recomendación y el mismo responsable: el
  contrato lo trata como reintento (`200`, no crea otra).
- `--solo-lectura` apaga todas las escrituras.
"""
from __future__ import annotations

import random
import re
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

MONTERREY = timezone(timedelta(hours=-6))
PROPORCION_XML = 0.2          # el escritorio consume XML (D-31): una de cada 5 lecturas
CAPTURAS_POR_LOTE = 5
DIAS_ATRAS_DISPONIBILIDAD = 30


# ----------------------------------------------------------------------------- forma de la carga

@dataclass(frozen=True)
class Etapa:
    nombre: str
    segundos: int
    usuarios: int
    ritmo: float              # usuarios nuevos por segundo al subir


#: 5 → 10 → 25 → 50, un pico de 60 y la bajada a 10 (guía del Parcial 3). Con 5 perfiles de igual peso,
#: el pico necesita 12 sesiones por perfil: `sesiones.py --por-perfil 12`.
ETAPAS = (
    Etapa('calentamiento', 60, 5, 1),
    Etapa('baja', 120, 10, 1),
    Etapa('media', 180, 25, 2),
    Etapa('alta', 240, 50, 2),
    Etapa('pico', 60, 60, 10),
    Etapa('recuperacion', 120, 10, 5),
)


def etapa_en(segundo: float, etapas=ETAPAS, escala: float = 1.0) -> tuple[Etapa, int] | None:
    """La etapa activa en el segundo `segundo` y sus usuarios (× escala, al menos 1); None al terminar."""
    fin = 0
    for e in etapas:
        fin += e.segundos
        if segundo < fin:
            return e, max(1, round(e.usuarios * escala))
    return None


def duracion(etapas=ETAPAS) -> int:
    return sum(e.segundos for e in etapas)


def sesiones_necesarias(etapas=ETAPAS, perfiles: int = 5, escala: float = 1.0) -> int:
    """Sesiones por perfil para el máximo de usuarios (Locust reparte igual entre los 5 perfiles)."""
    pico = max(max(1, round(e.usuarios * escala)) for e in etapas)
    return -(-pico // perfiles)


# ----------------------------------------------------------------------------- respuestas

def clasificar(estado: int, esperados: tuple[int, ...] = (200, 201)) -> str:
    """`ok` | `limitado` (429: el límite de auth u otro, se cuenta aparte) | `falla`."""
    if estado in esperados:
        return 'ok'
    if estado == 429:
        return 'limitado'
    return 'falla'


# ----------------------------------------------------------------------------- datos de la prueba

@dataclass
class Fixtures:
    """Ids reales del ambiente, de `preparar.py` (`carga/.fixtures.json`)."""
    zonas: list[dict]                       # {id, nombre, segmentId}
    tiendas: list[dict]                     # {id, zonaId}
    productos: list[dict]                   # {id, sku, presentaciones: [id]}
    recomendacion: str | None = None        # recomendación `aceptada` para la asignación
    responsable: str | None = None          # usuario asignado (Planeador del seed)
    clasificadas: list[dict] = field(default_factory=list)

    def __post_init__(self):
        self.clasificadas = [z for z in self.zonas if z.get('segmentId')]

    @classmethod
    def desde(cls, datos: dict) -> 'Fixtures':
        return cls(datos['zonas'], datos['tiendas'], datos['productos'], datos.get('recomendacion'),
                   datos.get('responsable'))


def correlacion(corrida: str) -> str:
    return f'carga-{corrida}-{uuid.uuid4().hex[:12]}'


def lote_sync(fx: Fixtures, rng: random.Random, dispositivo: str, ahora: datetime | None = None) -> dict:
    """Lote del móvil (contrato de offline-sync, §4.1): disponibilidad vieja y precio observado."""
    ahora = (ahora or datetime.now(timezone.utc)).astimezone(MONTERREY).replace(microsecond=0)
    capturas = []
    for i in range(CAPTURAS_POR_LOTE):
        tienda = rng.choice(fx.tiendas)['id']
        presentacion = rng.choice(rng.choice(fx.productos)['presentaciones'])
        if i % 2 == 0:
            tipo, cuando = 'disponibilidad', ahora - timedelta(days=DIAS_ATRAS_DISPONIBILIDAD)
            contenido = {'stock': rng.randint(0, 40)}
        else:
            tipo, cuando = 'precio_observado', ahora - timedelta(minutes=rng.randint(1, 120))
            contenido = {'price': round(rng.uniform(10, 120), 2), 'lat': 25.6866, 'lng': -100.3161}
        capturas.append({'captureId': str(uuid.uuid4()), 'type': tipo, 'contractVersion': '1.0',
                         'capturedAt': cuando.isoformat(), 'storeId': tienda, 'presentationId': presentacion,
                         'content': contenido})
    return {'batchId': str(uuid.uuid4()), 'deviceId': dispositivo, 'contractVersion': '1.0', 'client': 'movil',
            'sentAt': ahora.isoformat(), 'captures': capturas}


def promocion(fx: Fixtures, rng: random.Random, corrida: str, hoy: date | None = None) -> dict:
    """Promoción `descuento_porcentual` por zona (contrato de promotion, §6), que empieza mañana."""
    hoy = hoy or datetime.now(MONTERREY).date()
    producto = rng.choice(fx.productos)
    desde = hoy + timedelta(days=1)
    return {'name': f'carga-{corrida}-{uuid.uuid4().hex[:8]}', 'type': 'descuento_porcentual',
            'productId': producto['id'], 'presentationId': rng.choice(producto['presentaciones']),
            'zoneId': rng.choice(fx.zonas)['id'], 'discountPct': rng.randint(5, 30),
            'validFrom': desde.isoformat(), 'validTo': (desde + timedelta(days=14)).isoformat()}


def asignacion(fx: Fixtures) -> dict | None:
    if not fx.recomendacion or not fx.responsable:
        return None
    return {'recommendationId': fx.recomendacion, 'assigneeUserId': fx.responsable,
            'note': 'Seguimiento de la prueba de carga (reintento idempotente).'}


# ----------------------------------------------------------------------------- lecturas por perfil

@dataclass(frozen=True)
class Lectura:
    peso: int
    servicio: str
    plantilla: str            # nombre en las estadísticas: sin ids, para agrupar
    ruta: object              # (Fixtures, Random) -> str
    esperados: tuple[int, ...] = (200,)


def _zona(fx, rng):
    return rng.choice(fx.zonas)['id']


def _producto(fx, rng):
    return rng.choice(fx.productos)


def _grupo(fx, rng):
    z = rng.choice(fx.clasificadas or fx.zonas)
    return f"zoneId={z['id']}&segmentId={z.get('segmentId', 1)}"


LECTURAS: dict[str, list[Lectura]] = {
    'catalogo': [
        Lectura(5, 'catalog-service', '/v1/products?page=', lambda fx, r: f'/v1/products?limit=20&page={r.randint(1, 2)}'),
        Lectura(3, 'catalog-service', '/v1/products/:id/presentations',
                lambda fx, r: f"/v1/products/{_producto(fx, r)['id']}/presentations"),
        Lectura(3, 'pricing-service', '/v1/prices/current?presentationId=',
                lambda fx, r: f"/v1/prices/current?presentationId={r.choice(_producto(fx, r)['presentaciones'])}"),
        Lectura(2, 'pricing-service', '/v1/prices/compare-zones?productId=',
                lambda fx, r: f"/v1/prices/compare-zones?productId={_producto(fx, r)['id']}"),
        Lectura(2, 'algorithms-core', '/v1/elasticity/current', lambda fx, r: '/v1/elasticity/current?limit=20'),
    ],
    'investigador': [
        Lectura(3, 'catalog-service', '/v1/stores', lambda fx, r: '/v1/stores?limit=20'),
        Lectura(3, 'catalog-service', '/v1/products?search=', lambda fx, r: f"/v1/products?search={_producto(fx, r)['sku']}"),
        Lectura(1, 'catalog-service', '/v1/zones', lambda fx, r: '/v1/zones?limit=20'),
    ],
    'analista': [
        Lectura(3, 'basket-analysis-service', '/v1/typical-basket', lambda fx, r: f'/v1/typical-basket?{_grupo(fx, r)}'),
        Lectura(2, 'basket-analysis-service', '/v1/category-mix', lambda fx, r: f'/v1/category-mix?{_grupo(fx, r)}'),
        Lectura(3, 'availability-service', '/v1/availability/zones/:id/coverage',
                lambda fx, r: f'/v1/availability/zones/{_zona(fx, r)}/coverage'),
        Lectura(2, 'core-process-service', '/v1/transactions', lambda fx, r: '/v1/transactions?limit=20'),
        Lectura(2, 'demand-forecast-service', '/v1/forecast/runs', lambda fx, r: '/v1/forecast/runs?limit=20'),
        Lectura(2, 'income-segmentation-service', '/v1/zone-classifications',
                lambda fx, r: '/v1/zone-classifications?limit=20'),
        Lectura(1, 'analytics-stats', '/v1/clustering/runs', lambda fx, r: '/v1/clustering/runs?limit=20'),
        Lectura(1, 'data-governance-service', '/v1/quality-report', lambda fx, r: '/v1/quality-report'),
        # Sin listado en el contrato: un id que no existe mide token + sesión + consulta y responde 404.
        Lectura(1, 'transactions-ingestion-service', '/v1/transaction-imports/:id (404)',
                lambda fx, r: f'/v1/transaction-imports/{uuid.UUID(int=r.getrandbits(128), version=4)}',
                esperados=(404,)),
    ],
    'gerente': [
        Lectura(3, 'decision-service', '/v1/accessibility/by-zone/:id',
                lambda fx, r: f'/v1/accessibility/by-zone/{_zona(fx, r)}'),
        Lectura(2, 'decision-service', '/v1/recommendations', lambda fx, r: '/v1/recommendations?limit=20'),
        Lectura(2, 'documents-service', '/v1/reports', lambda fx, r: '/v1/reports?limit=20'),
        Lectura(2, 'promotion-service', '/v1/promotions', lambda fx, r: '/v1/promotions?limit=20'),
    ],
    'administrador': [
        Lectura(3, 'monitoring-service', '/v1/monitoring/services', lambda fx, r: '/v1/monitoring/services'),
        Lectura(3, 'audit-service', '/v1/auditoria', lambda fx, r: '/v1/auditoria?limit=20'),
        Lectura(2, 'auth-service', '/v1/usuarios', lambda fx, r: '/v1/usuarios?limit=20'),
        Lectura(2, 'notifications-service', '/v1/notifications/unread-count',
                lambda fx, r: '/v1/notifications/unread-count'),
        Lectura(2, 'data-governance-service', '/v1/sources', lambda fx, r: '/v1/sources'),
        Lectura(1, 'data-governance-service', '/v1/lineage', lambda fx, r: '/v1/lineage?limit=20'),
    ],
}

#: Peso de cada escritura frente a las lecturas de su perfil (0 con `--solo-lectura`).
ESCRITURAS = {
    'catalogo': {'aprobar_promocion': 2},
    'investigador': {'lote_sync': 3, 'propiedad': 1},
    'analista': {'pronostico': 1},
    'gerente': {'proponer_promocion': 2, 'asignar': 1},
    'administrador': {},
}


#: Servicio al que va cada escritura (para saltarla si su servicio no responde, `--saltar-caidos`).
SERVICIO_DE_ESCRITURA = {
    'aprobar_promocion': 'promotion-service', 'proponer_promocion': 'promotion-service',
    'lote_sync': 'offline-sync-service', 'propiedad': 'offline-sync-service',
    'pronostico': 'demand-forecast-service',
    'asignar': 'recommendations-workflow-service',
}


def servicios_usados() -> set[str]:
    return {l.servicio for ls in LECTURAS.values() for l in ls} | set(SERVICIO_DE_ESCRITURA.values())


def elegir_lectura(perfil: str, rng: random.Random, caidos: frozenset[str] = frozenset()) -> Lectura | None:
    """Una lectura del perfil por peso, sin las de servicios caídos; None si no queda ninguna."""
    opciones = [o for o in LECTURAS[perfil] if o.servicio not in caidos]
    if not opciones:
        return None
    return rng.choices(opciones, weights=[o.peso for o in opciones])[0]


def acciones(perfil: str, solo_lectura: bool, caidos: frozenset[str] = frozenset()) -> tuple[list[str], list[int]]:
    """Qué puede hacer el perfil en cada iteración y con qué peso: 'leer' (la suma de sus lecturas
    vivas) y cada escritura cuyo servicio responde."""
    nombres, pesos = [], []
    lecturas = sum(l.peso for l in LECTURAS[perfil] if l.servicio not in caidos)
    if lecturas:
        nombres.append('leer')
        pesos.append(lecturas)
    if not solo_lectura:
        for nombre, peso in ESCRITURAS[perfil].items():
            if SERVICIO_DE_ESCRITURA[nombre] not in caidos:
                nombres.append(nombre)
                pesos.append(peso)
    return nombres, pesos


def quiere_xml(rng: random.Random) -> bool:
    return rng.random() < PROPORCION_XML


# ----------------------------------------------------------------------------- validación de negocio
# "Valida respuestas de negocio, acuses y propiedad, además del código HTTP" (guía del Parcial 3).
# Cada función devuelve None si la respuesta es correcta, o el problema en una frase. El locustfile
# marca la petición como falla con el prefijo NEGOCIO para separarla de las fallas HTTP.

PREFIJO_NEGOCIO = 'NEGOCIO'
ESTADOS_SEGUIMIENTO = {'asignada', 'en_implementacion', 'implementada', 'evaluada'}
_UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')


def validar_xml(texto: str) -> str | None:
    """XML bien formado y que no sea un cuerpo de error (la validación XSD se hace aparte, por servicio)."""
    try:
        raiz = ET.fromstring(texto)
    except ET.ParseError as e:
        return f'XML mal formado: {e}'
    if raiz.tag.rsplit('}', 1)[-1] == 'error':
        return 'XML de error con código de éxito'
    return None


def validar_listado(cuerpo) -> str | None:
    """Listados paginados (`paginacion.md`): `data` arreglo y `total` entero ≥ len(data)."""
    if isinstance(cuerpo, dict) and 'data' in cuerpo:
        if not isinstance(cuerpo['data'], list):
            return '`data` no es un arreglo'
        if 'total' in cuerpo and (not isinstance(cuerpo['total'], int) or cuerpo['total'] < len(cuerpo['data'])):
            return f"`total` inválido ({cuerpo['total']!r}) para {len(cuerpo['data'])} filas"
    return None


def validar_disponible(cuerpo, campo: str | None = None) -> str | None:
    """D-20 / D-36: lo no publicable sale `disponible:false` con motivo y SIN valor, nunca 0."""
    if not isinstance(cuerpo, dict) or not isinstance(cuerpo.get('disponible'), bool):
        return 'falta `disponible`'
    if cuerpo['disponible']:
        if campo and cuerpo.get(campo) is None:
            return f'`disponible:true` sin `{campo}`'
        return None
    if not cuerpo.get('motivo'):
        return '`disponible:false` sin `motivo`'
    if campo and cuerpo.get(campo) is not None:
        return f'`disponible:false` con `{campo}` = {cuerpo[campo]!r} (debe omitirse, D-20)'
    return None


def _zona_de_la_ruta(ruta: str) -> str | None:
    m = _UUID.search(ruta)
    return m.group(0) if m else None


def validar_accesibilidad(cuerpo, ruta: str) -> str | None:
    zona = _zona_de_la_ruta(ruta)
    filas = cuerpo if isinstance(cuerpo, list) else [cuerpo]
    for f in filas:
        if not isinstance(f, dict) or f.get('zoneId') != zona:
            return f"accesibilidad de otra zona ({f.get('zoneId') if isinstance(f, dict) else f!r})"
    return None


def validar_no_encontrado(cuerpo) -> str | None:
    if not isinstance(cuerpo, dict) or cuerpo.get('code') != 'NOT_FOUND':
        return f"404 sin el cuerpo estándar (code = {cuerpo.get('code') if isinstance(cuerpo, dict) else cuerpo!r})"
    return None


#: Validación específica por lectura (por su nombre en las estadísticas); las demás, `validar_listado`.
VALIDA_LECTURA = {
    '/v1/availability/zones/:id/coverage': lambda c, r: validar_disponible(c, 'coverage'),
    '/v1/typical-basket': lambda c, r: validar_disponible(c) or (None if 'group' in c else 'falta `group`'),
    '/v1/category-mix': lambda c, r: validar_disponible(c),
    '/v1/accessibility/by-zone/:id': validar_accesibilidad,
    '/v1/transaction-imports/:id (404)': lambda c, r: validar_no_encontrado(c),
}


def validar_lectura(lectura: Lectura, cuerpo, ruta: str) -> str | None:
    especifica = VALIDA_LECTURA.get(lectura.plantilla)
    return especifica(cuerpo, ruta) if especifica else validar_listado(cuerpo)


def validar_acuse(lote: dict, acuse) -> str | None:
    """Acuse de offline-sync (§4.5): mismo lote, un resultado por captura en el mismo orden, conteo que
    cuadra y ningún rechazo. Cada captura sale `aceptada` o `conflicto` (D-42: ya había un dato capturado
    después; no se pierde). La disponibilidad vieja casi siempre es `conflicto`; un precio observado es
    `conflicto` si otra captura más reciente de esa tienda y presentación ya llegó."""
    if not isinstance(acuse, dict) or acuse.get('batchId') != lote['batchId']:
        return 'acuse de otro lote'
    resultados = acuse.get('results') or []
    if [r.get('captureId') for r in resultados] != [c['captureId'] for c in lote['captures']]:
        return 'el acuse no trae un resultado por captura en el orden del lote'
    resumen = acuse.get('summary') or {}
    if resumen.get('total') != len(lote['captures']):
        return f"summary.total = {resumen.get('total')!r}, se enviaron {len(lote['captures'])}"
    for r in resultados:
        if r.get('status') not in ('aceptada', 'conflicto'):
            motivo = (r.get('reason') or {}).get('code')
            return f"{r.get('type')} {r.get('status')} ({motivo}{', reintentable' if r.get('retryable') else ''})"
    return None


def validar_lote_propio(batch_id: str, acuse) -> str | None:
    if not isinstance(acuse, dict) or acuse.get('batchId') != batch_id:
        return 'el autor no recibe su propio lote'
    return None


def validar_promocion(enviada: dict, resp, estado: str) -> str | None:
    """Al proponer nace `pendiente` con lo enviado; al aprobar queda `aprobada` con quién la resolvió."""
    if not isinstance(resp, dict) or not resp.get('id'):
        return 'promoción sin `id`'
    if resp.get('status') != estado:
        return f"promoción en `{resp.get('status')}`, se esperaba `{estado}`"
    if estado == 'pendiente':
        for campo in ('name', 'presentationId', 'zoneId', 'validFrom', 'validTo'):
            if resp.get(campo) != enviada[campo]:
                return f'`{campo}` distinto al enviado'
    elif not resp.get('resolvedBy') or not resp.get('resolvedAt'):
        return 'aprobada sin `resolvedBy`/`resolvedAt`'
    return None


def validar_asignacion(enviada: dict, resp) -> str | None:
    if not isinstance(resp, dict):
        return 'respuesta vacía'
    if (resp.get('recommendationId') != enviada['recommendationId']
            or resp.get('assigneeUserId') != enviada['assigneeUserId']):
        return 'el seguimiento no corresponde a la recomendación o al responsable enviados'
    if resp.get('status') not in ESTADOS_SEGUIMIENTO:
        return f"estado de seguimiento desconocido `{resp.get('status')}`"
    return None


def validar_pronostico(estado: int, resp) -> str | None:
    """201: corrida con `id` y la regla de publicación (D-36/D-40); 422: error estándar con su `code`."""
    if estado == 422:
        return None if isinstance(resp, dict) and resp.get('code') else '422 sin el cuerpo estándar'
    if not isinstance(resp, dict) or not resp.get('id'):
        return 'corrida sin `id`'
    return validar_disponible(resp)
