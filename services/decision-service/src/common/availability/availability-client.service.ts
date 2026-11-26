import { Injectable, Logger } from '@nestjs/common';

/** Resultado de pedir la cobertura de básicos de una zona a availability-service. */
export type CoberturaZona =
  /** `valor` en 0..1 (`coverage / 100`). */
  | { estado: 'ok'; valor: number }
  /** availability respondió pero no hay datos vigentes (zona sin tiendas, sin básicos o datos vencidos, D-38). */
  | { estado: 'sin_datos'; motivo: string | null }
  /** availability no respondió, tardó más de 3 s o rechazó la llamada. */
  | { estado: 'no_responde'; motivo: string };

const TIMEOUT_MS = 3000;

/**
 * Cliente HTTP de availability-service (3114, D-38). La cobertura de básicos de la
 * accesibilidad sale de `GET /v1/availability/zones/:zoneId/coverage`, que ya aplica la
 * vigencia de 7 días; antes decision la calculaba por SQL sobre `inventario`, tabla que
 * pasó a ser de availability. Reenvía el `Authorization` de quien pidió el cálculo:
 * availability valida JWT + sesión en Redis como cualquier servicio. Nunca lanza.
 */
@Injectable()
export class AvailabilityClient {
  private readonly logger = new Logger(AvailabilityClient.name);

  async coberturaZona(zoneId: string, token?: string): Promise<CoberturaZona> {
    const base = (process.env.AVAILABILITY_SERVICE_URL ?? 'http://localhost:3114').replace(/\/$/, '');
    const control = new AbortController();
    const limite = setTimeout(() => control.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${base}/v1/availability/zones/${encodeURIComponent(zoneId)}/coverage`, {
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
        },
        signal: control.signal,
      });
      if (!r.ok) {
        await r.body?.cancel();
        return { estado: 'no_responde', motivo: `availability-service respondió ${r.status}` };
      }
      const cuerpo = (await r.json()) as { disponible?: boolean; coverage?: number; motivo?: string | null };
      if (cuerpo.disponible !== true || typeof cuerpo.coverage !== 'number' || !Number.isFinite(cuerpo.coverage)) {
        return { estado: 'sin_datos', motivo: cuerpo.motivo ?? null };
      }
      return { estado: 'ok', valor: Math.min(1, Math.max(0, cuerpo.coverage / 100)) };
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`availability-service no respondió (zona ${zoneId}): ${motivo}`);
      return { estado: 'no_responde', motivo };
    } finally {
      clearTimeout(limite);
    }
  }
}
