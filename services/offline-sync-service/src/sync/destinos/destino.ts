import { CapturaEntrada, Cliente, CodigoMotivo, Destino } from '../tipos';

/**
 * Puerto hacia los servicios destino (contrato §6).
 *
 * Dos adaptadores, elegidos con `SYNC_DESTINO` (ver `app.module.ts`):
 *  - `DestinoHttp` (`http`): `disponibilidad` → availability-service y
 *    `precio_observado` → pricing-service. Tabla de mapeo en el contrato §6.
 *  - `DestinoSimulado` (`simulado`): en memoria, para pruebas y demo.
 * `visita_campo` y `propuesta_producto` no entran en la versión 1.0.
 *
 * Lo que este servicio EXIGE de cualquier adaptador:
 *  - Idempotente por `captureId`: recibir dos veces la misma captura devuelve
 *    el mismo resultado y no crea nada nuevo (así un reproceso después de
 *    una caída no repite la operación).
 *  - Reenviar el `Authorization` del usuario y el `X-Correlation-Id`.
 *  - Timeout de 3 s: sin respuesta → `no_disponible` (captura reintentable).
 */
export const DESTINO_CAPTURAS = Symbol('DESTINO_CAPTURAS');

/** Modo y URLs de destino ya validados (`configDestino()` en `destino-http.ts`). */
export const CONFIG_DESTINO = Symbol('CONFIG_DESTINO');

export interface ContextoEnvio {
  token: string;
  correlationId: string;
  userId: string;
  client: Cliente;
}

export type RespuestaDestino =
  | { resultado: 'aceptada'; target: Destino }
  | { resultado: 'conflicto'; target: Destino | null; serverCapturedAt: string; message: string }
  | { resultado: 'rechazada'; code: CodigoMotivo; message: string }
  | { resultado: 'no_disponible'; message: string };

export interface DestinoCapturas {
  /** `http` (availability y pricing reales) o `simulado` (en memoria). */
  readonly modo: 'simulado' | 'http';
  enviar(captura: CapturaEntrada, contexto: ContextoEnvio): Promise<RespuestaDestino>;
}
