// Corre todas las pruebas e2e en serie y falla si alguna falla.   npm run test:e2e
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const archivos = readdirSync(dir).filter((f) => /^\d\d-.*\.mjs$/.test(f)).sort();
let fallo = false;
for (const f of archivos) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) fallo = true;
}
process.exit(fallo ? 1 : 0);
