import { CapturaEntrada, Cliente, CodigoMotivo, Destino } from '../tipos';

/**
 * Puerto hacia los servicios destino (contrato §6).
 *
 * ⚠️ El mapeo real hacia availability-service, pricing-service, visitas de
 * campo y propuestas de producto está **PENDIENTE de acuerdo con Pamela**.
 * Por eso hoy solo existe `DestinoSimulado`; no hay adaptador HTTP.
 *
 * Lo que este servicio EXIGE de cualquier adaptador:
 *  - Idempotente por `captureId`: recibir dos veces la misma captura devuelve
 *    el mismo resultado y no crea nada nuevo (así un reproceso después de
 *    una caída no repite la operación).
 *  - Reenviar el `Authorization` del usuario y el `X-Correlation-Id`.
 *  - Timeout de 3 s: sin respuesta → `no_disponible` (captura reintentable).
 */
export const DESTINO_CAPTURAS = Symbol('DESTINO_CAPTURAS');

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
  /** `simulado` hoy; `http` cuando se acuerde el mapeo (PENDIENTE). */
  readonly modo: 'simulado' | 'http';
  enviar(captura: CapturaEntrada, contexto: ContextoEnvio): Promise<RespuestaDestino>;
}
