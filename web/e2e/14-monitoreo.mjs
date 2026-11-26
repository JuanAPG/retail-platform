// T-09: panel de monitoreo del Administrador contra monitoring-service (3120) real.
// Cubre: los 20 servicios con estado, versión, latencia y último sondeo; historial de 24 h;
// 403 para otro rol (en la API y sin módulo en la web); un servicio detenido de verdad pasa a
// Caído (captura de pantalla como evidencia); monitor caído y sesión no validable (503) con
// mensaje comprensible y el último estado conservado.
// Requisitos: compose con monitoring-service y el web. Opcional: E2E_SERVICIO_A_DETENER
// (contenedor; por defecto retail_availability_service) y E2E_CAPTURA (ruta del PNG).
import { execSync } from 'node:child_process';
import { abrirNavegador, ok, resumen, sesion, rail, espera, json, USUARIOS, PASSWORD } from './lib.mjs';

const MONITOR = process.env.E2E_MONITOR_URL ?? 'http://localhost:3120';
const AUTH = process.env.E2E_AUTH_URL ?? 'http://localhost:3101';
const CONTENEDOR = process.env.E2E_SERVICIO_A_DETENER ?? 'retail_availability_service';
const SERVICIO = process.env.E2E_SERVICIO_DETENIDO ?? 'availability-service';
const CAPTURA = process.env.E2E_CAPTURA ?? 'monitoreo-servicio-caido.png';

async function token(rol) {
  const r = await fetch(`${AUTH}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USUARIOS[rol], password: PASSWORD }),
  });
  return (await r.json()).accessToken;
}

const navegador = await abrirNavegador();

// --- API: 401 sin sesión, 403 para otro rol, 200 para el Administrador.
{
  ok('api: sin sesión 401', (await fetch(`${MONITOR}/v1/monitoring/services`)).status === 401);
  for (const rol of ['analista', 'auditor', 'gerente']) {
    const r = await fetch(`${MONITOR}/v1/monitoring/services`, { headers: { Authorization: `Bearer ${await token(rol)}` } });
    ok(`api: ${rol} recibe 403`, r.status === 403, String(r.status));
  }
  const admin = await fetch(`${MONITOR}/v1/monitoring/services`, { headers: { Authorization: `Bearer ${await token('admin')}` } });
  ok('api: Administrador 200 con 20 servicios', admin.status === 200 && (await admin.json()).data.length === 20);
}

// --- Otro rol: la web no le ofrece el módulo.
{
  const { ctx, page } = await sesion(navegador, 'analista');
  ok('web: el Analista no ve el módulo Monitoreo', (await rail(page, 'Monitoreo').count()) === 0);
  await ctx.close();
}

{
  const { ctx, page } = await sesion(navegador, 'admin');
  await rail(page, 'Monitoreo').click();
  ok('panel: carga la tabla', await espera(page, /Monitoreo de servicios/, 8000));
  await page.waitForSelector('[data-testid=tabla-monitoreo] tr[data-servicio]', { timeout: 10000 });
  const filas = page.locator('[data-testid=tabla-monitoreo] tr[data-servicio]');
  ok('panel: muestra los 20 servicios', (await filas.count()) === 20, String(await filas.count()));
  const docs = page.locator('tr[data-servicio="documents-service"]');
  const textoDocs = await docs.innerText();
  ok('panel: estado, versión, latencia y último sondeo', /Operativo|Degradado|Caído|Sin/.test(textoDocs) && /\d+ ms/.test(textoDocs) && /hace/.test(textoDocs), textoDocs.replace(/\s+/g, ' '));
  ok('panel: resumen por estado', await espera(page, /Operativo: \d+/, 3000));

  // Historial de 24 h.
  await page.getByRole('button', { name: 'Historial de documents-service' }).click();
  ok('panel: abre el historial de 24 h', await espera(page, /Últimas 24 h · documents-service/, 8000));
  const conSondeos = await page
    .waitForSelector('[data-testid=historial-monitoreo] tbody tr', { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  ok('panel: el historial trae sondeos', conSondeos);

  // Falla real: se detiene un servicio y el monitor lo marca caído (timeout 3 s o 2 fallos seguidos, cada 30 s).
  execSync(`docker stop ${CONTENEDOR}`, { stdio: 'ignore' });
  let caido = false;
  try {
    for (let i = 0; i < 12 && !caido; i++) {
      await page.waitForTimeout(10_000);
      await page.getByRole('button', { name: /Actualizar ahora|Actualizando/ }).click().catch(() => {});
      await page.waitForTimeout(1500);
      caido = (await page.locator(`tr[data-servicio="${SERVICIO}"]`).getAttribute('data-estado')) === 'caido';
    }
    ok(`panel: ${SERVICIO} detenido aparece como Caído`, caido);
    await page.locator(`tr[data-servicio="${SERVICIO}"]`).scrollIntoViewIfNeeded();
    // Captura del viewport (con fullPage el Rail fijo se estira y deforma la imagen).
    await page.screenshot({ path: CAPTURA });
    console.log(`      captura: ${CAPTURA}`);
  } finally {
    execSync(`docker start ${CONTENEDOR}`, { stdio: 'ignore' });
  }

  // Monitor inaccesible: mensaje claro y se conserva el último estado.
  await page.route('**/v1/monitoring/services', (r) => r.abort('connectionrefused'));
  await page.getByRole('button', { name: 'Actualizar ahora' }).click();
  ok('panel: monitor caído → mensaje comprensible', await espera(page, /El servicio de monitoreo no responde/, 6000));
  ok('panel: conserva el último estado conocido', (await filas.count()) === 20 && (await espera(page, /último estado conocido/, 2000)));
  await page.unroute('**/v1/monitoring/services');

  // Sesión no validable (Redis caído en el monitor → 503).
  await page.route('**/v1/monitoring/services', json({ statusCode: 503, code: 'SERVICE_UNAVAILABLE', message: 'Redis no responde', details: null, path: '/v1/monitoring/services', timestamp: new Date().toISOString() }, 503));
  await page.getByRole('button', { name: 'Actualizar ahora' }).click();
  ok('panel: 503 → explica que no se pudo validar la sesión', await espera(page, /No se pudo validar tu sesión/, 6000));
  await page.unroute('**/v1/monitoring/services');

  ok('panel: sin errores JS', page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}

await navegador.close();
process.exit(resumen('14 monitoreo (T-09)') ? 1 : 0);
