import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/** Una regla de asociación como la entrega algorithms-core (`GET /v1/association/runs/:id`). */
export interface ReglaAsociacion {
  id: string;
  support: number;
  confidence: number;
  lift: number | null;
  items: { productId: string; side: 'antecedente' | 'consecuente'; product: { nombre: string } | null }[];
}

/** La corrida de la que salen las reglas, para citarla como evidencia. */
export interface CorridaConReglas {
  runId: string;
  /** `apriori` o `fpgrowth` (parámetro `algoritmo`, D2). */
  algoritmo: string;
  reglas: ReglaAsociacion[];
}

interface CorridaResumen {
  id: string;
  status: 'completada' | 'fallida';
  parameters: { key: string; value: string }[];
}

/** Límite por llamada: la regla de asociación no debe colgar `generate`. */
const TIMEOUT_MS = 3000;
/** Páginas del historial que se revisan buscando una corrida completada. */
const PAGINAS_MAXIMAS = 5;
const POR_PAGINA = 100;

/**
 * Cliente HTTP de algorithms-core. Las corridas de Apriori y FP-Growth viven
 * en MongoDB (D3) y los servicios se consultan por HTTP, nunca leyendo
 * tablas ajenas. Se reenvía el `Authorization` de quien pidió la operación:
 * algorithms-core valida JWT + sesión en Redis como cualquier otro servicio.
 *
 * A diferencia de audit y notifications, esto NO es fire-and-forget: son
 * datos que la recomendación necesita. Si algorithms-core no responde o
 * rechaza la llamada, `503` con motivo claro; nunca se omite en silencio.
 */
@Injectable()
export class AlgorithmsClient {
  private readonly logger = new Logger(AlgorithmsClient.name);

  /**
   * Reglas de la corrida de asociación completada más reciente, o `null` si
   * todavía no hay ninguna (sin corridas no hay venta cruzada que proponer).
   */
  async reglasDeLaUltimaCorrida(token?: string): Promise<CorridaConReglas | null> {
    for (let page = 1; page <= PAGINAS_MAXIMAS; page++) {
      const pagina = await this.get<{ data: CorridaResumen[] }>(`/v1/association/runs?page=${page}&limit=${POR_PAGINA}`, token);
      const corrida = pagina.data.find((c) => c.status === 'completada');
      if (corrida) {
        const detalle = await this.get<{ results?: ReglaAsociacion[] }>(`/v1/association/runs/${corrida.id}`, token);
        return {
          runId: corrida.id,
          algoritmo: corrida.parameters.find((p) => p.key === 'algoritmo')?.value ?? 'apriori',
          reglas: detalle.results ?? [],
        };
      }
      if (pagina.data.length < POR_PAGINA) return null;
    }
    return null;
  }

  private async get<T>(ruta: string, token?: string): Promise<T> {
    const base = process.env.ALGORITHMS_SERVICE_URL ?? 'http://localhost:3105';
    const controller = new AbortController();
    const limite = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const respuesta = await fetch(`${base}${ruta}`, {
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!respuesta.ok) {
        throw new ServiceUnavailableException(
          `No se pudieron leer las reglas de asociación: algorithms-core respondió ${respuesta.status}.`,
        );
      }
      return (await respuesta.json()) as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`algorithms-core no respondió (${ruta}): ${motivo}`);
      throw new ServiceUnavailableException('No se pudieron leer las reglas de asociación: algorithms-core no responde.');
    } finally {
      clearTimeout(limite);
    }
  }
}
