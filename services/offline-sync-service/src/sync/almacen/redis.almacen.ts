import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { getRedis } from '../../common/auth/redis.client';
import { AlmacenRapido, CapturaEnCache } from './puertos';

/**
 * Llaves de Redis del contrato §7 (D-47: idempotencia, último estado).
 * Nada más se guarda en Redis; la fuente de verdad es MongoDB.
 */
export const llaves = {
  candado: (batchId: string) => `sync:lock:${batchId}`,
  captura: (captureId: string) => `sync:captura:${captureId}`,
  ultimo: (llave: string) => `sync:ultimo:${llave}`,
};

/** Resultado final en caché: 7 días; después se consulta Mongo. */
const VIGENCIA_CAPTURA_S = 7 * 24 * 60 * 60;

/** Suelta el candado solo si sigue siendo de quien lo tomó. */
const SOLTAR = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

/** Guarda el instante solo si es mayor (las fechas ISO en UTC se comparan como texto). */
const SUBIR = `local actual = redis.call('GET', KEYS[1])
if (not actual) or actual < ARGV[1] then redis.call('SET', KEYS[1], ARGV[1]) return 1 end
return 0`;

@Injectable()
export class RedisAlmacen implements AlmacenRapido {
  private readonly logger = new Logger('redis');

  private async conRedis<T>(operacion: () => Promise<T>): Promise<T> {
    try {
      return await operacion();
    } catch (error) {
      this.logger.error(`Redis no responde: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException('No se pudo procesar el lote: Redis no responde. Reintenta más tarde.');
    }
  }

  tomarCandado(batchId: string, dueno: string, ms: number): Promise<boolean> {
    return this.conRedis(async () => (await getRedis().set(llaves.candado(batchId), dueno, 'PX', ms, 'NX')) === 'OK');
  }

  soltarCandado(batchId: string, dueno: string): Promise<void> {
    return this.conRedis(async () => {
      await getRedis().eval(SOLTAR, 1, llaves.candado(batchId), dueno);
    });
  }

  leerCapturas(ids: string[]): Promise<Map<string, CapturaEnCache>> {
    return this.conRedis(async () => {
      const mapa = new Map<string, CapturaEnCache>();
      if (ids.length === 0) return mapa;
      const valores = await getRedis().mget(...ids.map(llaves.captura));
      valores.forEach((valor, i) => {
        if (!valor) return;
        try {
          mapa.set(ids[i], JSON.parse(valor) as CapturaEnCache);
        } catch {
          // Un valor corrupto se ignora: Mongo tiene el dato.
        }
      });
      return mapa;
    });
  }

  guardarCaptura(captura: CapturaEnCache): Promise<void> {
    return this.conRedis(async () => {
      await getRedis().set(llaves.captura(captura.captureId), JSON.stringify(captura), 'EX', VIGENCIA_CAPTURA_S);
    });
  }

  leerUltimo(llave: string): Promise<string | null> {
    return this.conRedis(() => getRedis().get(llaves.ultimo(llave)));
  }

  subirUltimo(llave: string, instanteIso: string): Promise<void> {
    return this.conRedis(async () => {
      await getRedis().eval(SUBIR, 1, llaves.ultimo(llave), instanteIso);
    });
  }
}
