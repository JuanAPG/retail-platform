import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { conCorrelacion } from '../common/correlation/correlacion';

/** Contrato §5: decision-service sin respuesta en 3 s → 503. */
export const LIMITE_DECISION_MS = 3000;

/** `propuesta` | `aceptada` | `descartada` (decision-service). */
export interface RecomendacionDecision {
  recommendationId: string;
  status: string;
}

/** Sin `DECISION_SERVICE_URL` el servicio no arranca (no podría verificar nada). */
export function urlDecision(entorno: NodeJS.ProcessEnv = process.env): string {
  const url = entorno.DECISION_SERVICE_URL?.trim();
  if (!url) {
    throw new Error('recommendations-workflow-service necesita DECISION_SERVICE_URL (verifica por HTTP que la recomendación esté aceptada, contrato §5).');
  }
  return url;
}

/**
 * Verifica la recomendación por HTTP (§5), sin leer la tabla de
 * decision-service: `GET {DECISION_SERVICE_URL}/v1/recommendations/:id/explain`
 * con el `Authorization` del usuario y el `X-Correlation-Id`, timeout 3 s.
 */
@Injectable()
export class DecisionCliente {
  private readonly logger = new Logger('decision');
  private readonly base = urlDecision();

  /** `null` si decision-service responde 404. Sin respuesta, 5xx o algo que no se entiende → 503. */
  async recomendacion(id: string, token: string): Promise<RecomendacionDecision | null> {
    const url = new URL(`v1/recommendations/${id}/explain`, this.base.endsWith('/') ? this.base : `${this.base}/`).toString();
    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        headers: conCorrelacion({ Accept: 'application/json', Authorization: token }),
        signal: AbortSignal.timeout(LIMITE_DECISION_MS),
      });
    } catch (error) {
      const nombre = (error as { name?: string })?.name;
      throw new ServiceUnavailableException(
        nombre === 'TimeoutError' ? 'decision-service no respondió en 3 s.' : 'decision-service no responde.',
      );
    }
    if (respuesta.status === 404) return null;
    if (respuesta.status >= 500) throw new ServiceUnavailableException(`decision-service respondió con error ${respuesta.status}.`);
    const cuerpo = (await respuesta.json().catch(() => null)) as RecomendacionDecision | null;
    if (respuesta.status !== 200 || !cuerpo || typeof cuerpo.status !== 'string') {
      this.logger.warn(JSON.stringify({ evento: 'decision_inesperada', status: respuesta.status }));
      throw new ServiceUnavailableException(`decision-service respondió de forma inesperada (${respuesta.status}).`);
    }
    return cuerpo;
  }
}
