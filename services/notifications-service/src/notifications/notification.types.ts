import { ROL } from '../common/roles';

/** Prioridades del contrato (cerrado). */
export type Priority = 'info' | 'warning' | 'critical';

/**
 * Servicios que pueden emitir notificaciones (lista cerrada).
 *
 * No incluye `auth-service` ni `notifications-service`: el primero no
 * emite eventos de negocio y el segundo no se notifica a sí mismo.
 */
export const SERVICIOS_EMISORES = [
  'catalog-service',
  'pricing-service',
  'core-process-service',
  'algorithms-core',
  'analytics-stats',
  'decision-service',
  'documents-service',
  'audit-service',
] as const;

export type SourceService = (typeof SERVICIOS_EMISORES)[number];

export function esServicioEmisor(valor: string): valor is SourceService {
  return (SERVICIOS_EMISORES as readonly string[]).includes(valor);
}

/** Tipos de evento soportados (matriz de disparadores, Fase A). */
export type EventType =
  | 'producto.propuesto'
  | 'precio.propuesto'
  | 'propuesta.resuelta'
  | 'proveedor.solicitud'
  | 'proveedor.resuelto'
  | 'precio.umbral'
  | 'precio.observado'
  | 'observacion.resuelta'
  | 'corrida.terminada'
  | 'escenario.generado'
  | 'recomendacion.generada'
  | 'recomendacion.resuelta';

/** Entrada de lectura por usuario (nunca flag global). */
export interface ReadMark {
  userId: string;
  readAt: Date;
}

/** Lectura ya serializada para la API (fechas como ISO). */
export interface ReadMarkPublic {
  userId: string;
  readAt: string;
}

/** Notificación tal como la ve la API (fechas ya como ISO). */
export interface Notification {
  id: string;
  eventType: string;
  sourceService: string | null;
  recipientUserId: string | null;
  recipientRole: string | null;
  title: string;
  message: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  priority: Priority;
  readBy: ReadMarkPublic[];
  archived: boolean;
  createdAt: string;
}

interface AtributosEvento {
  priority: Priority;
  title: string;
  relatedEntityType: string;
}

/**
 * Matriz de eventos (contrato Fase A): priority/title/entidad por tipo.
 * El `message` lo arma el emisor con el detalle; si no lo manda, se usa
 * este genérico. Tabla congelada con el equipo en el contrato.
 */
const MATRIZ: Record<EventType, AtributosEvento> = {
  'producto.propuesto': {
    priority: 'info',
    title: 'Nueva propuesta de producto',
    relatedEntityType: 'producto',
  },
  'precio.propuesto': {
    priority: 'info',
    title: 'Nuevo precio propuesto',
    relatedEntityType: 'presentacion',
  },
  'propuesta.resuelta': {
    priority: 'info',
    title: 'Tu propuesta fue resuelta',
    relatedEntityType: 'producto',
  },
  'proveedor.solicitud': {
    priority: 'info',
    title: 'Solicitud de proveedor',
    relatedEntityType: 'proveedor',
  },
  'proveedor.resuelto': {
    priority: 'info',
    title: 'Tu solicitud fue resuelta',
    relatedEntityType: 'proveedor',
  },
  'precio.umbral': {
    priority: 'warning',
    title: 'Precio fuera de rango',
    relatedEntityType: 'presentacion',
  },
  'precio.observado': {
    priority: 'info',
    title: 'Precio observado en tienda pendiente de revisión',
    relatedEntityType: 'precio_observado',
  },
  'observacion.resuelta': {
    priority: 'info',
    title: 'Tu precio observado fue resuelto',
    relatedEntityType: 'precio_observado',
  },
  'corrida.terminada': {
    priority: 'info',
    title: 'Corrida terminada',
    relatedEntityType: 'corrida',
  },
  'escenario.generado': {
    priority: 'info',
    title: 'Nuevo escenario',
    relatedEntityType: 'escenario',
  },
  'recomendacion.generada': {
    priority: 'info',
    title: 'Nueva recomendación',
    relatedEntityType: 'recomendacion',
  },
  'recomendacion.resuelta': {
    priority: 'info',
    title: 'Recomendación resuelta',
    relatedEntityType: 'recomendacion',
  },
};

export function esEventoSoportado(eventType: string): eventType is EventType {
  return eventType in MATRIZ;
}

// =====================================================================
// Quién puede disparar qué, y a quién le llega
// =====================================================================

/**
 * A quién va dirigido un evento.
 *
 * - `rol`: destino FIJO. Lo decide la regla del evento, no el emisor: si
 *   manda otro `recipientRole`, se rechaza.
 * - `usuario`: destino dinámico (el proveedor que propuso, el solicitante
 *   que espera respuesta). El emisor manda `recipientUserId`; es el único
 *   que sabe a quién le toca.
 * - `pendiente`: el destino NO está decidido por el equipo todavía. Se
 *   acepta lo que mande el emisor, pero el ORIGEN sí se valida. No es un
 *   default silencioso: está anotado evento por evento abajo.
 */
export type Destino =
  | { tipo: 'rol'; rol: string }
  | { tipo: 'usuario' }
  | { tipo: 'pendiente' };

export interface PermisoEvento {
  /** Roles que pueden ORIGINAR el evento. Fuera de la lista → 403. */
  origenes: readonly string[];
  destino: Destino;
  /**
   * Roles que reciben COPIA automática (decisión del equipo: el Auditor ve
   * resoluciones y alertas sin que el emisor mande un segundo aviso). Se
   * guarda una notificación por rol en copia, con su propio dedup.
   */
  copias?: readonly string[];
  /** De dónde salió la regla, para poder discutirla sin arqueología. */
  fundamento: string;
}

/**
 * Permisos por tipo de evento — EL EMISOR NO DECIDE ESTO.
 *
 * Antes cualquier usuario autenticado podía fabricar cualquier evento para
 * cualquier destinatario: un Proveedor mandó una notificación `critical`
 * al rol Gerente de categoría y el Gerente la recibió.
 *
 * El `origen` de cada regla NO se inventó: sale de los `@Roles` del
 * endpoint que de verdad dispara la acción en el servicio dueño. Así, si
 * mañana cambia quién puede aprobar un producto, el fundamento dice dónde
 * mirar.
 *
 * Un evento que no esté en esta tabla NO se puede emitir (403). Es
 * deliberado: preferible que un emisor nuevo falle ruidosamente a que
 * cualquiera pueda inventar eventos.
 */
const PERMISOS: Record<EventType, PermisoEvento> = {
  // catalog: POST /v1/products/proposals -> @Roles(PROVEEDOR);
  // lo resuelve APRUEBAN_PRODUCTOS = [Administrador, Gerente de categoría].
  'producto.propuesto': {
    origenes: [ROL.PROVEEDOR],
    destino: { tipo: 'rol', rol: ROL.GERENTE_CATEGORIA },
    fundamento: 'catalog POST products/proposals es solo del Proveedor; la bandeja que actúa es el Gerente de categoría.',
  },

  // pricing: POST /v1/price-proposals -> @Roles(PROVEEDOR);
  // lo resuelve APRUEBAN_PRECIOS = [Responsable de precios] (decisión D1).
  'precio.propuesto': {
    origenes: [ROL.PROVEEDOR],
    destino: { tipo: 'rol', rol: ROL.RESPONSABLE_PRECIOS },
    fundamento: 'pricing POST price-proposals es solo del Proveedor; la aprueba ÚNICAMENTE el Responsable de precios (D1), así que su bandeja es la de ese rol y no la del Gerente de categoría.',
  },

  // catalog: PATCH products/:id/approve|reject -> APRUEBAN_PRODUCTOS = [Gerente de categoría]
  // y pricing: PATCH price-proposals/:id/approve|reject -> [Responsable de precios] (D1).
  // Le llega al proveedor que propuso: solo el emisor sabe quién es.
  'propuesta.resuelta': {
    origenes: [ROL.GERENTE_CATEGORIA, ROL.RESPONSABLE_PRECIOS],
    destino: { tipo: 'usuario' },
    copias: [ROL.AUDITOR],
    fundamento: 'Quien aprueba o rechaza una propuesta de producto es el Gerente de categoría y una de precio, el Responsable de precios (D1); el aviso va al proveedor que la hizo, con copia al Auditor.',
  },

  // pricing: POST /v1/prices -> @Roles(Responsable de precios) (D1).
  // Destino fijado por el equipo 2026-10-08: el Responsable de precios es
  // la bandeja del área que actúa sobre el umbral, no el Gerente. D-09:
  // copia al Auditor.
  'precio.umbral': {
    origenes: [ROL.RESPONSABLE_PRECIOS],
    destino: { tipo: 'rol', rol: ROL.RESPONSABLE_PRECIOS },
    copias: [ROL.AUDITOR],
    fundamento: 'pricing POST prices es solo del Responsable de precios (D1). Destino: Responsable de precios (bandeja del área), decidido el 2026-10-08; copia al Auditor (D-09).',
  },

  // PRI-09/D-16: pricing POST /v1/price-observations (app móvil) ->
  // @Roles(CAPTURAN_OBSERVACIONES) = [Analista comercial, Responsable de
  // precios] (pricing/src/common/roles.ts:56). Nace `pendiente`: avisa a
  // quien la resuelve. Agregado 2026-10-09 junto con `observacion.resuelta`
  // porque PriceObservationsService no emitía ninguno de los dos (no
  // inyectaba NotificationsReporter).
  'precio.observado': {
    origenes: [ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS],
    destino: { tipo: 'rol', rol: ROL.RESPONSABLE_PRECIOS },
    fundamento:
      'pricing POST price-observations es de Analista y Responsable de precios (CAPTURAN_OBSERVACIONES). Destino: Responsable de precios, que es quien la resuelve (D1 APRUEBAN_PRECIOS).',
  },

  // PRI-09/D-16: pricing PATCH price-observations/:id/approve|reject ->
  // @Roles(APRUEBAN_PRECIOS) = [Responsable de precios] (D1, mismo rol que
  // resuelve propuestas de precio). Le llega a quien la capturó
  // (`capturado_por`): solo el emisor sabe quién fue.
  'observacion.resuelta': {
    origenes: [ROL.RESPONSABLE_PRECIOS],
    destino: { tipo: 'usuario' },
    copias: [ROL.AUDITOR],
    fundamento:
      'pricing PATCH price-observations/:id/approve|reject es D1 APRUEBAN_PRECIOS = [Responsable de precios]. El aviso va a quien capturó la observación (recipientUserId), con copia al Auditor.',
  },

  // ALG-10: algorithms-core POST association/apriori|fpgrowth/run ->
  // @Roles(Analista comercial) y POST elasticity/calculate ->
  // @Roles(Responsable de precios). Vuelve a quien lanzó la corrida
  // (dinámico, igual que escenario.generado): es un resultado suyo, no de
  // un área. `analytics-stats` no emite este evento todavía.
  'corrida.terminada': {
    origenes: [ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS],
    destino: { tipo: 'usuario' },
    fundamento:
      'algorithms-core: Apriori/FP-Growth son del Analista comercial y la elasticidad del Responsable de precios. Destino: quien lanzó la corrida (recipientUserId).',
  },

  // decision (D-12): el Planeador simula y genera recomendaciones; el
  // Gerente de categoría las aprueba o rechaza. Un escenario vuelve a
  // quien lo pidió (decidido 2026-10-08).
  'escenario.generado': {
    origenes: [ROL.PLANEADOR],
    destino: { tipo: 'usuario' },
    fundamento: 'decision POST simulation/* es del Planeador (D-12). Destino: el usuario que lo generó (recipientUserId), decidido el 2026-10-08.',
  },

  // D-12: la genera el Planeador y la bandeja que actúa es la del Gerente
  // de categoría, que la aprueba o rechaza.
  'recomendacion.generada': {
    origenes: [ROL.PLANEADOR],
    destino: { tipo: 'rol', rol: ROL.GERENTE_CATEGORIA },
    fundamento: 'decision POST recommendations/generate es del Planeador (D-12). Destino: Gerente de categoría, que la resuelve.',
  },

  // D-12: el Gerente resuelve; el aviso vuelve al Planeador que la generó,
  // con copia al Auditor.
  'recomendacion.resuelta': {
    origenes: [ROL.GERENTE_CATEGORIA],
    destino: { tipo: 'rol', rol: ROL.PLANEADOR },
    copias: [ROL.AUDITOR],
    fundamento: 'El Gerente de categoría aprueba o rechaza la recomendación (D-12). Destino: Planeador, con copia al Auditor.',
  },

  // SIN flujo implementado en ningún servicio: no hay endpoint de alta ni
  // de resolución de solicitudes de proveedor. Quedan FUERA de la tabla a
  // propósito, así que hoy no se pueden emitir (403); en cuanto exista el
  // endpoint, su `@Roles` da el origen y se agregan aquí.
  'proveedor.solicitud': {
    origenes: [],
    destino: { tipo: 'pendiente' },
    fundamento: 'SIN REGLA: no existe endpoint de solicitud de proveedor en ningún servicio, así que no hay de dónde sacar el origen. No se puede emitir hasta decidirlo.',
  },
  'proveedor.resuelto': {
    origenes: [],
    destino: { tipo: 'pendiente' },
    fundamento: 'SIN REGLA: no existe endpoint de resolución de solicitudes de proveedor. No se puede emitir hasta decidirlo.',
  },
};

/** Permiso de un evento soportado. */
export function permisoDe(eventType: EventType): PermisoEvento {
  return PERMISOS[eventType];
}

/** Para documentación y pruebas: la tabla completa. */
export function permisos(): Readonly<Record<EventType, PermisoEvento>> {
  return PERMISOS;
}

/** Atributos por defecto de un tipo de evento (priority/title/entidad). */
export function atributosDe(eventType: EventType): AtributosEvento {
  return MATRIZ[eventType];
}

/** Ventana anti-duplicados: mismo evento+entidad en los últimos 5 minutos. */
export const VENTANA_DEDUP_MINUTOS = 5;

/** Edad para archivar: más de 90 días. Nunca se elimina nada. */
export const DIAS_PARA_ARCHIVAR = 90;
