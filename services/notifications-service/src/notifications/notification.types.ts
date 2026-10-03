/** Prioridades del contrato (cerrado). */
export type Priority = 'info' | 'warning' | 'critical';

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

/** Atributos por defecto de un tipo de evento (priority/title/entidad). */
export function atributosDe(eventType: EventType): AtributosEvento {
  return MATRIZ[eventType];
}

/** Ventana anti-duplicados: mismo evento+entidad en los últimos 5 minutos. */
export const VENTANA_DEDUP_MINUTOS = 5;

/** Edad para archivar: más de 90 días. Nunca se elimina nada. */
export const DIAS_PARA_ARCHIVAR = 90;
