/**
 * Levanta MongoDB y Redis AISLADOS para la integración: contenedores propios
 * (`offline-sync-it-*`, puertos 27118 y 6418), sin volumen y sin tocar los de
 * `infra/docker-compose.yml`. Se borran al terminar (`contenedores-fin.ts`).
 *
 * Con `SYNC_IT_DOCKER=0` no se levanta nada: se usan MONGO_URL / REDIS_* del
 * entorno (p. ej. en otra máquina con Mongo y Redis propios). Ojo: las pruebas
 * de caída (503) pausan los contenedores, así que en ese modo se omiten.
 */
import { execFileSync } from 'child_process';

export const MONGO = 'offline-sync-it-mongo';
export const REDIS = 'offline-sync-it-redis';

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function esperar(descripcion: string, prueba: () => void, intentos = 60): Promise<void> {
  for (let i = 0; i < intentos; i += 1) {
    try {
      prueba();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`${descripcion} no estuvo listo a tiempo.`);
}

export default async function levantar(): Promise<void> {
  if (process.env.SYNC_IT_DOCKER === '0') return;
  for (const nombre of [MONGO, REDIS]) {
    try {
      docker('rm', '-f', nombre);
    } catch {
      // no existía
    }
  }
  docker('run', '-d', '--name', MONGO, '-p', '27118:27017', 'mongo:7');
  docker('run', '-d', '--name', REDIS, '-p', '6418:6379', 'redis:7');
  await esperar('MongoDB', () => docker('exec', MONGO, 'mongosh', '--quiet', '--eval', 'db.runCommand({ping:1}).ok'));
  await esperar('Redis', () => {
    if (docker('exec', REDIS, 'redis-cli', 'ping') !== 'PONG') throw new Error('sin PONG');
  });
}
