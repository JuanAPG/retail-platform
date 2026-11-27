// D-41 / T-24 — El Gerente asigna responsable a una recomendación aprobada y, cuando el responsable
// la implementa (paso del escritorio, aquí por API), evalúa su impacto desde la web.
// Requiere recommendations-workflow-service (3117) y auth con GET /v1/usuarios/asignables.
import { abrirNavegador, ok, resumen, sesion, rail, espera, USUARIOS, PASSWORD } from './lib.mjs';

const AUTH = process.env.E2E_AUTH_URL ?? 'http://localhost:3101';
const WF = process.env.E2E_WORKFLOW_URL ?? 'http://localhost:3117';
const login = async (rol) => (await (await fetch(`${AUTH}/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: USUARIOS[rol], password: PASSWORD }) })).json()).accessToken;
// El servicio valida fechas en el huso del negocio (BUSINESS_TIMEZONE, Monterrey), no en UTC.
const diaMty = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Monterrey' }).format(new Date(ms));
const hoy = diaMty(Date.now());
const ayer = diaMty(Date.now() - 86400000);

const DECISION = process.env.E2E_DECISION_URL ?? 'http://localhost:3107';

/** Deja al menos una recomendación aceptada SIN seguimiento: si no hay, el Planeador genera y el Gerente aprueba (API). */
async function asegurarRecomendacionPorAsignar() {
  const g = { Authorization: `Bearer ${await login('gerente')}` };
  const aceptadas = (await (await fetch(`${DECISION}/v1/recommendations?status=aceptada&limit=100`, { headers: g })).json()).data ?? [];
  const seguidas = new Set(((await (await fetch(`${WF}/v1/workflow/assignments?limit=100`, { headers: g })).json()).data ?? []).map((x) => x.recommendationId));
  if (aceptadas.some((r) => !seguidas.has(r.id))) return true;
  let propuestas = (await (await fetch(`${DECISION}/v1/recommendations?status=propuesta&limit=100`, { headers: g })).json()).data ?? [];
  if (propuestas.length === 0) {
    const p = { Authorization: `Bearer ${await login('planeador')}`, 'Content-Type': 'application/json' };
    await fetch(`${DECISION}/v1/recommendations/generate`, { method: 'POST', headers: p, body: '{}' });
    propuestas = (await (await fetch(`${DECISION}/v1/recommendations?status=propuesta&limit=100`, { headers: g })).json()).data ?? [];
  }
  if (propuestas.length === 0) return false;
  const r = await fetch(`${DECISION}/v1/recommendations/${propuestas[0].id}/approve`, { method: 'PATCH', headers: g });
  return r.ok;
}

if (!(await asegurarRecomendacionPorAsignar())) {
  console.log('No se pudo preparar una recomendación aprobada sin seguimiento (decision no generó ninguna).');
  process.exit(1);
}

const navegador = await abrirNavegador();
{
  const { ctx, page } = await sesion(navegador, 'analista');
  ok('seguimientos: el Analista no ve el módulo', (await rail(page, 'Seguimientos').count()) === 0);
  await ctx.close();
}

const { ctx, page } = await sesion(navegador, 'gerente');
await rail(page, 'Seguimientos').click();
ok('seguimientos: abre el módulo', await espera(page, /Seguimiento de recomendaciones/, 8000));
const tarjeta = page.locator('[data-recomendacion]').first();
await tarjeta.waitFor({ timeout: 8000 });
const recomendacionId = await tarjeta.getAttribute('data-recomendacion');
const opciones = await tarjeta.locator('select option').allInnerTexts();
ok('seguimientos: lista responsables con nombre y rol', opciones.some((o) => /Analista comercial/.test(o)), opciones.slice(0, 5).join(' | '));

await tarjeta.getByRole('button', { name: 'Asignar' }).click();
ok('seguimientos: sin responsable se valida', await espera(page, /Elige a quién asignarla/, 3000));
// Puede haber varios Analistas (p. ej. las cuentas de carga): se asigna exactamente a la cuenta que
// luego inicia, por su id (sub del JWT); si no, el inicio responde 403 por no ser el responsable.
const analista = await login('analista');
const subAnalista = JSON.parse(Buffer.from(analista.split('.')[1], 'base64url').toString()).sub;
await tarjeta.locator('select').selectOption({ value: subAnalista });
await tarjeta.locator('input[placeholder]').fill('Aplicar el ajuste en las tiendas de la zona');
await tarjeta.getByRole('button', { name: 'Asignar' }).click();
ok('seguimientos: asigna y avisa', await espera(page, /Asignada a .*aviso para iniciarla/, 6000));
ok('seguimientos: aparece como Asignada', await espera(page, /Asignada: el responsable aún no la inicia/, 6000));

// El responsable (Analista) inicia e implementa: en el producto esto es del escritorio.
const lista = await (await fetch(`${WF}/v1/workflow/assignments?recommendationId=${recomendacionId}`, { headers: { Authorization: `Bearer ${await login('gerente')}` } })).json();
const seg = lista.data[0];
const h = { Authorization: `Bearer ${analista}`, 'Content-Type': 'application/json' };
const ini = await fetch(`${WF}/v1/workflow/assignments/${seg.id}/start`, { method: 'PATCH', headers: h });
const imp = await fetch(`${WF}/v1/workflow/assignments/${seg.id}/implement`, { method: 'PATCH', headers: h, body: JSON.stringify({ implementedOn: hoy, note: 'Ajuste aplicado en las tiendas de la zona.' }) });
// 409 en start = ya estaba iniciado (corrida anterior interrumpida); lo que importa es que quede implementado.
ok('responsable inicia e implementa (API)', [200, 409].includes(ini.status) && imp.status === 200, `${ini.status}/${imp.status}`);

await page.reload();
await rail(page, 'Seguimientos').click();
const fila = page.locator(`[data-seguimiento="${seg.id}"]`);
await fila.waitFor({ timeout: 8000 });
ok('seguimientos: ofrece evaluar lo implementado', (await fila.getAttribute('data-estado')) === 'implementada');
await fila.getByRole('button', { name: 'Evaluar impacto' }).click();
const form = fila.locator('[data-testid=evaluar-seguimiento]');
const selects = form.locator('select');
await selects.nth(2).selectOption({ index: 1 }); // zona
const fechas = form.locator('input[type=date]');
await fechas.nth(0).fill(ayer); await fechas.nth(1).fill(ayer);
await fechas.nth(2).fill(hoy); await fechas.nth(3).fill(hoy);
const nums = form.locator('input[type=number]');
await nums.nth(0).fill('0');
await nums.nth(1).fill('1150');
await form.locator('input[placeholder^="Reporte"]').fill('Reporte ejecutivo, ventas de básicos en la zona');
await form.getByRole('button', { name: 'Registrar evaluación' }).click();
ok('evaluación: "antes" en 0 se explica en la web', await espera(page, /mayor que cero/, 3000));
await nums.nth(0).fill('1000');
await form.getByRole('button', { name: 'Registrar evaluación' }).click();
ok('evaluación: caso de control 1000 → 1150 = 15 %', await espera(page, /variación de 15 %/, 6000));
ok('seguimientos: queda Evaluada', await espera(page, /Evaluada/, 6000));
ok('sin errores JS', page.errores.length === 0, page.errores[0] ?? '');
await ctx.close();
await navegador.close();
process.exit(resumen('17 seguimientos (D-41)') ? 1 : 0);
