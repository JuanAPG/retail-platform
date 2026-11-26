import { execFileSync } from 'child_process';
import { MONGO, REDIS } from './contenedores';

/** Borra los contenedores aislados de la integración (nunca los de infra/). */
export default async function bajar(): Promise<void> {
  if (process.env.SYNC_IT_DOCKER === '0') return;
  for (const nombre of [MONGO, REDIS]) {
    try {
      execFileSync('docker', ['rm', '-f', nombre], { stdio: 'ignore' });
    } catch {
      // ya no estaba
    }
  }
}
