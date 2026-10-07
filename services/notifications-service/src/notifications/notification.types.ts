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
  // lo resuelve APRUEBAN_PRECIOS = [Administrador, Gerente de categoría].
  'precio.propuesto': {
    origenes: [ROL.PROVEEDOR],
    destino: { tipo: 'rol', rol: ROL.GERENTE_CATEGORIA },
    fundamento: 'pricing POST price-proposals es solo del Proveedor; lo aprueba APRUEBAN_PRECIOS, cuya bandeja es el Gerente de categoría.',
  },

  // catalog: PATCH products/:id/approve|reject y pricing: PATCH
  // price-proposals/:id/approve|reject -> @Roles(Administrador, Gerente).
  // Le llega al proveedor que propuso: solo el emisor sabe quién es.
  'propuesta.resuelta': {
    origenes: [ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA],
    destino: { tipo: 'usuario' },
    fundamento: 'Quien aprueba o rechaza una propuesta es Administrador o Gerente; el aviso va al proveedor que la hizo.',
  },

  // pricing: POST /v1/prices -> @Roles(Administrador, Responsable de precios).
  'precio.umbral': {
    origenes: [ROL.ADMINISTRADOR, ROL.RESPONSABLE_PRECIOS],
    destino: { tipo: 'pendiente' },
    fundamento: 'pricing POST prices es de Administrador y Responsable de precios. DESTINO PENDIENTE: no está decidido si el aviso va al Responsable de precios (bandeja del área) o al Gerente de categoría (quien decide comercialmente).',
  },

  // decision: POST /v1/simulation/price|presentation -> @Roles(Administrador, Analista).
  'escenario.generado': {
    origenes: [ROL.ADMINISTRADOR, ROL.ANALISTA],
    destino: { tipo: 'pendiente' },
    fundamento: 'decision POST simulation/* es de Administrador y Analista. DESTINO PENDIENTE: los escenarios los consumen todos los perfiles internos; no hay un rol único definido.',
  },

  // decision: POST /v1/recommendations/generate -> @Roles(Administrador, Analista).
  'recomendacion.generada': {
    origenes: [ROL.ADMINISTRADOR, ROL.ANALISTA],
    destino: { tipo: 'pendiente' },
    fundamento: 'decision POST recommendations/generate es de Administrador y Analista. DESTINO PENDIENTE: falta decidir si la recomendación le llega al Gerente de categoría o al Planeador.',
  },

  'recomendacion.resuelta': {
    origenes: [ROL.GERENTE_CATEGORIA],
    destino: { tipo: 'pendiente' },
    fundamento: 'El Gerente de categoría resuelve la recomendación (decidido por el equipo). DESTINO PENDIENTE: falta decidir si el aviso vuelve a quien la generó (Analista) o al Planeador.',
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
