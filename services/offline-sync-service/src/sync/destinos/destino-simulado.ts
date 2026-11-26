import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { llaveDato } from '../reglas';
import { CapturaEntrada, CodigoMotivo, Destino } from '../tipos';
import { ContextoEnvio, DestinoCapturas, RespuestaDestino } from './destino';

/**
 * Destino SIMULADO (en memoria), con `SYNC_DESTINO=simulado`. ⚠️ No envía
 * nada a availability-service ni a pricing-service: eso lo hace
 * `DestinoHttp` (`SYNC_DESTINO=http`, el modo por defecto). Sirve para las
 * pruebas unitarias y una demo sin destinos; lo que "acepta" se pierde al
 * reiniciar el proceso.
 *
 * Imita lo que ya dicen los contratos de destino, sin inventar reglas:
 *  - `disponibilidad` (como availability-service): gana el dato capturado
 *    después; si ya tiene uno capturado igual o después → `conflicto`.
 *    El id de destino es el mismo `captureId`.
 *  - `precio_observado` (como pricing-service): toda observación queda
 *    registrada (pasa a aprobación, D-16) y recibe un id nuevo. NO decide
 *    conflictos: pricing no compara fechas.
 *  - Idempotente por `captureId` (lo que §6 exige a todo destino).
 *
 * Los métodos `sembrarDato`, `rechazarTienda`, `caer` y `latencia` son
 * ganchos para las pruebas; no hay ruta HTTP que los exponga.
 */
@Injectable()
export class DestinoSimulado implements DestinoCapturas {
  readonly modo = 'simulado' as const;
  private readonly logger = new Logger('destino-simulado');

  /** Lo que ya recibió, por `captureId` (idempotencia). */
  private readonly recibidas = new Map<string, RespuestaDestino>();
  /** Último `capturedAt` (ms) por tipo + tienda + presentación. */
  private readonly datos = new Map<string, number>();
  private readonly tiendasRechazadas = new Map<string, { code: CodigoMotivo; message: string }>();
  private caido = false;
  private demoraMs = 0;

  /** Cada llamada que llegó (para verificar que no se repite y que viaja la correlación). */
  readonly llamadas: Array<{ captureId: string; correlationId: string; token: string; userId: string }> = [];

  async enviar(captura: CapturaEntrada, contexto: ContextoEnvio): Promise<RespuestaDestino> {
    this.llamadas.push({
      captureId: captura.captureId,
      correlationId: contexto.correlationId,
      token: contexto.token,
      userId: contexto.userId,
    });
    if (this.demoraMs > 0) await new Promise((r) => setTimeout(r, this.demoraMs));
    if (this.caido) {
      const servicio = this.servicio(captura);
      return { resultado: 'no_disponible', message: `${servicio} no respondió en 3 s. Reintenta el lote.` };
    }

    const previa = this.recibidas.get(captura.captureId);
    if (previa) return previa;

    const rechazo = captura.storeId ? this.tiendasRechazadas.get(captura.storeId) : undefined;
    const respuesta = rechazo ? ({ resultado: 'rechazada', ...rechazo } as const) : this.registrar(captura);
    this.recibidas.set(captura.captureId, respuesta);
    this.logger.log(
      JSON.stringify({
        evento: 'captura_simulada',
        correlationId: contexto.correlationId,
        captureId: captura.captureId,
        type: captura.type,
        resultado: respuesta.resultado,
      }),
    );
    return respuesta;
  }

  private registrar(captura: CapturaEntrada): RespuestaDestino {
    const target: Destino = {
      service: this.servicio(captura),
      id: captura.type === 'disponibilidad' ? captura.captureId : randomUUID(),
    };
    if (captura.type === 'precio_observado') return { resultado: 'aceptada', target };

    const llave = llaveDato(captura);
    const capturada = new Date(captura.capturedAt).getTime();
    const existente = this.datos.get(llave);
    if (existente !== undefined && existente >= capturada) {
      const serverCapturedAt = new Date(existente).toISOString();
      return {
        resultado: 'conflicto',
        target,
        serverCapturedAt,
        message: `El servidor ya tiene un dato de esta tienda y presentación capturado el ${serverCapturedAt}, más reciente que esta captura. No se sobrescribió; la captura quedó guardada.`,
      };
    }
    this.datos.set(llave, capturada);
    return { resultado: 'aceptada', target };
  }

  private servicio(captura: CapturaEntrada): Destino['service'] {
    return captura.type === 'disponibilidad' ? 'availability-service' : 'pricing-service';
  }

  // ---------- ganchos de prueba ----------

  /** Simula un dato que el destino ya tenía (p. ej. una corrección del Analista desde la web). */
  sembrarDato(captura: Pick<CapturaEntrada, 'type' | 'storeId' | 'presentationId'>, capturedAt: string): void {
    this.datos.set(llaveDato(captura), new Date(capturedAt).getTime());
  }

  /** El destino responderá 4xx para esa tienda (p. ej. tienda inexistente → 400). */
  rechazarTienda(storeId: string, code: CodigoMotivo, message: string): void {
    this.tiendasRechazadas.set(storeId, { code, message });
  }

  caer(caido: boolean): void {
    this.caido = caido;
  }

  latencia(ms: number): void {
    this.demoraMs = ms;
  }

  reiniciar(): void {
    this.recibidas.clear();
    this.datos.clear();
    this.tiendasRechazadas.clear();
    this.llamadas.length = 0;
    this.caido = false;
    this.demoraMs = 0;
  }
}
