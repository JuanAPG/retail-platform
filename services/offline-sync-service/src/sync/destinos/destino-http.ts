import { Logger } from '@nestjs/common';
import { CapturaEntrada, CodigoMotivo, Destino, ServicioDestino } from '../tipos';
import { ContextoEnvio, DestinoCapturas, RespuestaDestino } from './destino';

/**
 * Destino REAL por HTTP (contrato §6): manda cada captura a su servicio
 * dueño y traduce la respuesta al acuse.
 *
 *  - `disponibilidad`   → `POST {AVAILABILITY_SERVICE_URL}/v1/availability/captures`
 *  - `precio_observado` → `POST {PRICING_SERVICE_URL}/v1/price-observations`
 *
 * Los dos destinos son idempotentes por el id del dispositivo (`captureId` /
 * `observationId = captureId`): reenviar la misma captura no crea nada nuevo y
 * devuelve el resultado original (200). Por eso todo caso "no sé si llegó"
 * (timeout, red, 5xx) se puede marcar `no_disponible` (reintentable) sin
 * riesgo de duplicar.
 *
 * Reenvía el `Authorization` del usuario y el `X-Correlation-Id` del lote,
 * con timeout de 3 s. Nunca registra el token.
 */

export const TIMEOUT_DESTINO_MS = 3000;

export interface ConfigDestinoHttp {
  availabilityUrl: string;
  pricingUrl: string;
  timeoutMs?: number;
  /** Para las pruebas unitarias (HTTP simulado). Por defecto, el `fetch` de Node. */
  fetch?: typeof fetch;
}

/** Lo que availability-service responde en `POST /v1/availability/captures` (`captureResponse`). */
interface RespuestaCaptura {
  captureId?: string;
  status?: string;
  /** Si algún día availability lo agrega en el 200 (duplicada), se usa antes que el texto de `reason`. */
  originalStatus?: string;
  currentCapturedAt?: string;
  reason?: string | null;
}

/** Lo que pricing-service responde en `POST /v1/price-observations` (`priceObservationResponse`). */
interface RespuestaObservacion {
  id?: string;
}

interface CuerpoError {
  message?: string;
  details?: string[] | null;
}

/**
 * En el 200 (`duplicada`) availability-service NO trae el resultado original
 * como campo: solo en el texto de `reason`, que arma
 * `captures.service.ts` (`Captura ya recibida (aceptada|conflicto); …`).
 */
const ORIGINAL_EN_REASON = /^Captura ya recibida \((aceptada|conflicto)\)/;

type Salida = { estado: number; cuerpo: unknown } | { error: string };

export class DestinoHttp implements DestinoCapturas {
  readonly modo = 'http' as const;
  private readonly logger = new Logger('destino-http');
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigDestinoHttp) {
    this.fetch = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_DESTINO_MS;
  }

  async enviar(captura: CapturaEntrada, contexto: ContextoEnvio): Promise<RespuestaDestino> {
    const respuesta =
      captura.type === 'disponibilidad'
        ? await this.disponibilidad(captura, contexto)
        : await this.precio(captura, contexto);
    // Solo ids y el resultado: nunca el token ni el contenido.
    this.logger.log(
      JSON.stringify({
        evento: 'captura_enviada',
        correlationId: contexto.correlationId,
        captureId: captura.captureId,
        type: captura.type,
        resultado: respuesta.resultado,
      }),
    );
    return respuesta;
  }

  // ---------------- disponibilidad → availability-service ----------------

  private async disponibilidad(c: CapturaEntrada, ctx: ContextoEnvio): Promise<RespuestaDestino> {
    const servicio: ServicioDestino = 'availability-service';
    const salida = await this.post(this.config.availabilityUrl, 'v1/availability/captures', ctx, {
      captureId: c.captureId,
      storeId: c.storeId,
      presentationId: c.presentationId,
      stock: c.content.stock,
      capturedAt: c.capturedAt,
      origin: ctx.client, // movil | escritorio, según el client del lote
    });
    if ('error' in salida) return noDisponible(servicio, salida.error);

    const { estado } = salida;
    const cuerpo = (salida.cuerpo ?? {}) as RespuestaCaptura;
    const target: Destino = { service: servicio, id: cuerpo.captureId ?? c.captureId };

    if (estado === 201) return this.resultadoCaptura(servicio, cuerpo.status, cuerpo, target);
    if (estado === 200) {
      // Duplicada en el destino: se devuelve el resultado ORIGINAL (el destino es idempotente).
      const original = cuerpo.originalStatus ?? ORIGINAL_EN_REASON.exec(cuerpo.reason ?? '')?.[1];
      if (!original) {
        return interno(
          `${servicio} respondió que la captura ya estaba registrada, pero sin decir su resultado original. ` +
            'No se marca como aceptada ni como conflicto para no adivinar.',
        );
      }
      return this.resultadoCaptura(servicio, original, cuerpo, target);
    }
    return this.porCodigo(servicio, estado, salida.cuerpo);
  }

  private resultadoCaptura(
    servicio: ServicioDestino,
    status: string | undefined,
    cuerpo: RespuestaCaptura,
    target: Destino,
  ): RespuestaDestino {
    if (status === 'aceptada') return { resultado: 'aceptada', target };
    if (status === 'conflicto') {
      const instante = cuerpo.currentCapturedAt ? new Date(cuerpo.currentCapturedAt) : null;
      if (!instante || Number.isNaN(instante.getTime())) {
        return interno(`${servicio} respondió conflicto sin la fecha del dato que ganó (currentCapturedAt).`);
      }
      const serverCapturedAt = instante.toISOString();
      return {
        resultado: 'conflicto',
        target,
        serverCapturedAt,
        // En el 201 el `reason` del destino ya lo explica; en el 200 (duplicada) el reason habla del reenvío.
        message:
          cuerpo.status === 'conflicto' && cuerpo.reason
            ? cuerpo.reason
            : `El servidor ya tiene un dato de esta tienda y presentación capturado el ${serverCapturedAt}, más reciente que esta captura. No se sobrescribió; la captura quedó guardada.`,
      };
    }
    return interno(`${servicio} respondió un status inesperado: ${String(status)}.`);
  }

  // ---------------- precio_observado → pricing-service ----------------

  private async precio(c: CapturaEntrada, ctx: ContextoEnvio): Promise<RespuestaDestino> {
    const servicio: ServicioDestino = 'pricing-service';
    const { lat, lng, price } = c.content;
    const salida = await this.post(this.config.pricingUrl, 'v1/price-observations', ctx, {
      observationId: c.captureId,
      presentationId: c.presentationId,
      storeId: c.storeId,
      price,
      observedAt: c.capturedAt,
      // lat y lng van juntas o ninguna (pricing responde 400 si llega una sola).
      ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
    });
    if ('error' in salida) return noDisponible(servicio, salida.error);

    const { estado } = salida;
    // 201 = observación nueva; 200 = mismo observationId del mismo usuario: la ORIGINAL.
    // Precios no decide conflicto por fecha: toda observación nueva queda pendiente de aprobación.
    if (estado === 201 || estado === 200) {
      const id = (salida.cuerpo as RespuestaObservacion | null)?.id;
      if (!id) return interno(`${servicio} registró la observación pero no devolvió su id.`);
      return { resultado: 'aceptada', target: { service: servicio, id } };
    }
    return this.porCodigo(servicio, estado, salida.cuerpo);
  }

  // ---------------- común ----------------

  /** Errores con el mismo significado en los dos destinos. */
  private porCodigo(servicio: ServicioDestino, estado: number, cuerpo: unknown): RespuestaDestino {
    const mensaje = mensajeDe(cuerpo) ?? `${servicio} respondió ${estado}.`;
    if (estado === 400) return rechazo('VALIDATION_ERROR', mensaje);
    if (estado === 403) return rechazo('FORBIDDEN', mensaje);
    // 409 en availability: captureId de otro usuario. En pricing: observationId de otro usuario
    // o producto/presentación no activos (mismo code CONFLICT; solo cambia el texto). Las dos
    // son definitivas para esta captura: rechazada, CONFLICT, con el mensaje del destino.
    if (estado === 409) return rechazo('CONFLICT', mensaje);
    // Nada se aplicó y reintentar es seguro (idempotente): reintentable.
    if (estado === 401) {
      return noDisponible(servicio, `rechazó la sesión (401): vuelve a iniciar sesión y reenvía el lote`);
    }
    if (estado >= 500 || estado === 404 || estado === 408 || estado === 429) {
      return noDisponible(servicio, `respondió ${estado}`);
    }
    return interno(`${servicio} respondió ${estado} inesperado: ${mensaje}`);
  }

  private async post(base: string, ruta: string, ctx: ContextoEnvio, cuerpo: object): Promise<Salida> {
    const url = new URL(ruta, base.endsWith('/') ? base : `${base}/`).toString();
    try {
      const r = await this.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: ctx.token.startsWith('Bearer ') ? ctx.token : `Bearer ${ctx.token}`,
          'X-Correlation-Id': ctx.correlationId,
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const texto = await r.text();
      let json: unknown = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch {
        json = null;
      }
      return { estado: r.status, cuerpo: json };
    } catch (error) {
      const nombre = (error as { name?: string })?.name;
      return {
        error:
          nombre === 'TimeoutError' || nombre === 'AbortError'
            ? `no respondió en ${this.timeoutMs >= 1000 ? `${Math.round(this.timeoutMs / 1000)} s` : `${this.timeoutMs} ms`}`
            : `no responde (${(error as Error)?.message ?? 'error de red'})`,
      };
    }
  }
}

function mensajeDe(cuerpo: unknown): string | null {
  const c = cuerpo as CuerpoError | null;
  if (!c?.message) return null;
  return c.details?.length ? `${c.message} ${c.details.join('; ')}` : c.message;
}

function rechazo(code: CodigoMotivo, message: string): RespuestaDestino {
  return { resultado: 'rechazada', code, message };
}

function interno(message: string): RespuestaDestino {
  return { resultado: 'rechazada', code: 'INTERNAL', message };
}

function noDisponible(servicio: ServicioDestino, motivo: string): RespuestaDestino {
  return { resultado: 'no_disponible', message: `${servicio} ${motivo}. Reintenta el lote.` };
}

/** Modo del destino (`SYNC_DESTINO`) y URLs, validados al arrancar. */
export type ModoDestino = 'http' | 'simulado';

export interface ConfigDestino {
  modo: ModoDestino;
  availabilityUrl: string | null;
  pricingUrl: string | null;
}

/**
 * Lee `SYNC_DESTINO` (`http` por defecto) y las URLs. Con `http` y sin alguna
 * URL, lanza un error que dice cuál falta: el servicio no arranca.
 */
export function configDestino(entorno: NodeJS.ProcessEnv = process.env): ConfigDestino {
  const crudo = (entorno.SYNC_DESTINO ?? 'http').trim().toLowerCase();
  if (crudo !== 'http' && crudo !== 'simulado') {
    throw new Error(`SYNC_DESTINO debe ser "http" o "simulado" (llegó "${entorno.SYNC_DESTINO}").`);
  }
  if (crudo === 'simulado') return { modo: 'simulado', availabilityUrl: null, pricingUrl: null };

  const faltan = ['AVAILABILITY_SERVICE_URL', 'PRICING_SERVICE_URL'].filter((v) => !entorno[v]?.trim());
  if (faltan.length) {
    throw new Error(
      `SYNC_DESTINO=http necesita ${faltan.join(' y ')}: sin ${faltan.length > 1 ? 'ellas' : 'ella'} el servicio no arranca. ` +
        'Defínela(s) o usa SYNC_DESTINO=simulado (solo pruebas y demo sin destinos).',
    );
  }
  for (const v of ['AVAILABILITY_SERVICE_URL', 'PRICING_SERVICE_URL']) {
    let protocolo = '';
    try {
      protocolo = new URL(entorno[v] as string).protocol;
    } catch {
      // se reporta abajo
    }
    if (protocolo !== 'http:' && protocolo !== 'https:') {
      throw new Error(`${v} no es una URL válida (http:// o https://): "${entorno[v]}".`);
    }
  }
  return {
    modo: 'http',
    availabilityUrl: (entorno.AVAILABILITY_SERVICE_URL as string).trim(),
    pricingUrl: (entorno.PRICING_SERVICE_URL as string).trim(),
  };
}

/** `GET {url}/v1/health` de un destino, para el health de este servicio. Nunca lanza. */
export async function saludDestino(base: string, timeoutMs = 2000, f: typeof fetch = fetch): Promise<string> {
  try {
    const url = new URL('v1/health', base.endsWith('/') ? base : `${base}/`).toString();
    const r = await f(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return `error: HTTP ${r.status}`;
    const cuerpo = (await r.json().catch(() => null)) as { status?: string } | null;
    return cuerpo?.status === 'ok' ? 'ok' : `error: ${cuerpo?.status ?? 'respuesta sin status'}`;
  } catch (error) {
    const nombre = (error as { name?: string })?.name;
    return nombre === 'TimeoutError' ? `error: no respondió en ${timeoutMs} ms` : `error: ${(error as Error)?.message ?? 'sin respuesta'}`;
  }
}
