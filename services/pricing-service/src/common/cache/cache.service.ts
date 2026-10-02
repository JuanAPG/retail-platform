import { Injectable, Logger } from '@nestjs/common';
import { getRedis } from '../auth/redis.client';

/** Cuánto esperar a Redis antes de seguir sin caché: la caché nunca debe volver lenta una consulta. */
const ESPERA_MAXIMA_MS = 300;

function conLimite<T>(promesa: Promise<T>): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('Redis no respondió a tiempo')), ESPERA_MAXIMA_MS);
    promesa.then(
      (valor) => {
        clearTimeout(reloj);
        resolver(valor);
      },
      (error) => {
        clearTimeout(reloj);
        rechazar(error);
      },
    );
  });
}

/**
 * Caché sobre el Redis compartido (Sprint 2+3). Convención de llaves:
 * `<prefijo-del-servicio>:<recurso>[:<parámetros>]`, con un prefijo propio por
 * servicio para no pisar a los otros nueve (`catalog:*`, `pricing:*`; además de
 * `session:*` y `revoked:*`, que son de autenticación).
 *
 * Reglas que cumple:
 *  - **Redis es opcional**: si no responde o falla, la consulta se resuelve
 *    contra Postgres como si la caché no existiera. Nunca lanza por culpa de Redis.
 *  - Solo se cachean resultados exitosos: un error del `cargar` (404, 400…) no se guarda.
 *  - Todo valor tiene TTL: una llave sin invalidar caduca sola.
 *  - Los valores se guardan como JSON, que es justo lo que la API serializa de todos modos.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  /**
   * Devuelve el valor cacheado en `clave`; si no hay, ejecuta `cargar`, lo guarda
   * `ttlSegundos` y lo devuelve.
   */
  async obtener<T>(clave: string, ttlSegundos: number, cargar: () => Promise<T>): Promise<T> {
    try {
      const guardado = await conLimite(getRedis().get(clave));
      if (guardado !== null) {
        this.logger.debug(`HIT ${clave}`);
        return JSON.parse(guardado) as T;
      }
    } catch (error) {
      this.avisar('leer', clave, error);
    }

    const valor = await cargar();

    try {
      await conLimite(getRedis().set(clave, JSON.stringify(valor), 'EX', ttlSegundos));
      this.logger.debug(`MISS ${clave} (guardada ${ttlSegundos}s)`);
    } catch (error) {
      this.avisar('guardar', clave, error);
    }
    return valor;
  }

  /** Borra llaves exactas (no patrones). Para invalidar al escribir. */
  async borrar(...claves: string[]): Promise<void> {
    if (claves.length === 0) return;
    try {
      await conLimite(getRedis().del(...claves));
    } catch (error) {
      this.avisar('borrar', claves.join(','), error);
    }
  }

  /**
   * Versión de un grupo de llaves (por ejemplo "todo lo cacheado de un producto").
   * Las llaves incluyen la versión; **invalidar el grupo es subir la versión**
   * (O(1), sin recorrer Redis con SCAN). Las llaves viejas quedan huérfanas y
   * caducan solas por su TTL. Devuelve 0 si Redis no responde.
   */
  async version(llaveVersion: string): Promise<number> {
    try {
      return Number((await conLimite(getRedis().get(llaveVersion))) ?? 0);
    } catch (error) {
      this.avisar('leer versión', llaveVersion, error);
      return 0;
    }
  }

  /**
   * Sube la versión de un grupo. La llave de versión vive más que cualquier
   * dato que dependa de ella (si caducara antes, una llave vieja podría
   * reaparecer con datos desactualizados).
   */
  async invalidarGrupo(llaveVersion: string, vidaSegundos = 24 * 60 * 60): Promise<void> {
    try {
      const redis = getRedis();
      await conLimite(redis.incr(llaveVersion));
      await conLimite(redis.expire(llaveVersion, vidaSegundos));
    } catch (error) {
      this.avisar('invalidar', llaveVersion, error);
    }
  }

  private avisar(operacion: string, clave: string, error: unknown) {
    const motivo = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Caché: no se pudo ${operacion} ${clave} (${motivo}); se continúa sin caché.`);
  }
}
