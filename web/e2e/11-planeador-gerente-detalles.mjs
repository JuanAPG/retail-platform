// Permisos invertidos de simulación/recomendaciones (QA del PR #64), D-12 (el Gerente decide),
// y los tres detalles: abrir una transacción, comparar dos zonas en accesibilidad, filtro por usuario en la bitácora.
import { abrirNavegador, ok, resumen, sesion, rail, texto, espera, BASE } from './lib.mjs';

const navegador = await abrirNavegador();
const boton = (page, nombre) => page.getByRole('button', { name: nombre });
// El Select del web es un listbox propio (no un <select> nativo): se abre y se elige por rol.
async function opcionesDe(page, id) {
  await page.locator(`#${id}`).click();
  await page.locator('[role=listbox]').waitFor({ timeout: 5000 });
  const textos = await page.locator('[role=option]').allInnerTexts();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return textos;
}
async function elegir(page, id, texto) {
  await page.locator(`#${id}`).click();
  await page.locator('[role=option]', { hasText: texto }).first().click();
  await page.waitForTimeout(200);
}


// --- Planeador: puede simular y generar
{
  const { ctx, page } = await sesion(navegador, 'planeador');
  await rail(page, 'Nueva simulación').click();
  await page.waitForTimeout(800);
  ok('planeador/simulación: NO ve el aviso de «solo Planeador»', !/Solo el Planeador puede crear/i.test(await texto(page)));
  await rail(page, 'Recomendaciones').click();
  await page.waitForTimeout(800);
  ok('planeador/recomendaciones: ve «Generar recomendaciones»', (await boton(page, 'Generar recomendaciones').count()) === 1);
  ok('planeador/recomendaciones: no ve Aprobar/Rechazar', (await boton(page, 'Aprobar').count()) === 0);
  await boton(page, 'Generar recomendaciones').click();
  const hubo201 = await page.waitForResponse((r) => r.url().includes('/recommendations/generate'), { timeout: 20000 }).then((r) => r.status()).catch(() => 0);
  ok('planeador: POST /recommendations/generate responde 201', hubo201 === 201, String(hubo201));
  await page.waitForTimeout(1500);
  ok('planeador: ningún 403 al simular/generar', !page.http.some((h) => h.startsWith('403')), page.http.join(' | '));
  const t = await texto(page);
  ok('planeador: tras generar aparece un estatus «propuesta» o el vacío explicado', /propuesta|aceptada|descartada|No se encontró nada/i.test(t));
  // recarga: la lista sobrevive (GET /recommendations)
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  await rail(page, 'Recomendaciones').click();
  await page.waitForTimeout(1200);
  ok('planeador: la lista sobrevive a recargar', /propuesta|aceptada|descartada|No se encontró nada/i.test(await texto(page)));
  ok('planeador: sin errores de página', page.errores.length === 0, page.errores.join(' | '));
  await ctx.close();
}

// --- Roles sin permiso: el botón no se ofrece (antes estaba al revés)
for (const rol of ['admin', 'analista']) {
  const { ctx, page } = await sesion(navegador, rol);
  await page.goto(`${BASE}/planeador`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const acceso = (await rail(page, 'Recomendaciones').count()) > 0;
  if (acceso) {
    await rail(page, 'Recomendaciones').click();
    await page.waitForTimeout(800);
    ok(`${rol}/recomendaciones: NO ofrece «Generar recomendaciones»`, (await boton(page, 'Generar recomendaciones').count()) === 0);
    await rail(page, 'Nueva simulación').click();
    await page.waitForTimeout(600);
    ok(`${rol}/simulación: explica que es del Planeador`, /Solo el Planeador/i.test(await texto(page)));
    ok(`${rol}: ningún 403 en el portal del Planeador`, !page.http.some((h) => h.startsWith('403')), page.http.join(' | '));
  } else {
    ok(`${rol}: el portal del Planeador no está disponible (sin botones que den 403)`, true);
  }
  await ctx.close();
}

// --- Gerente: D-12
{
  const { ctx, page } = await sesion(navegador, 'gerente');
  ok('gerente: el menú tiene «Recomendaciones»', (await rail(page, 'Recomendaciones').count()) === 1);
  await rail(page, 'Recomendaciones').click();
  await page.waitForTimeout(1500);
  ok('gerente: GET /recommendations sin error', !page.http.some((h) => /recommendations/.test(h)), page.http.join(' | '));
  ok('gerente: no ve «Generar recomendaciones»', (await boton(page, 'Generar recomendaciones').count()) === 0);
  const propuestas = await boton(page, 'Aprobar').count();
  ok('gerente: ve Aprobar en las propuestas (hay al menos una)', propuestas >= 1, `propuestas=${propuestas}`);
  if (propuestas >= 1) {
    // rechazo: el motivo corto no habilita el envío
    await boton(page, 'Rechazar').first().click();
    const confirmar = boton(page, 'Confirmar rechazo');
    ok('gerente: «Confirmar rechazo» deshabilitado sin motivo', await confirmar.isDisabled());
    await page.fill('textarea[aria-label="Motivo del rechazo"]', 'corto');
    ok('gerente: motivo de <10 caracteres sigue deshabilitado', await confirmar.isDisabled());
    await page.fill('textarea[aria-label="Motivo del rechazo"]', 'No aplica en temporada escolar.');
    ok('gerente: motivo válido habilita el envío', await confirmar.isEnabled());
    const [rej] = await Promise.all([
      page.waitForResponse((r) => /recommendations\/.+\/reject/.test(r.url()), { timeout: 15000 }).catch(() => null),
      confirmar.click(),
    ]);
    ok('gerente: PATCH reject responde 200', rej?.status() === 200, String(rej?.status()));
    await page.waitForTimeout(1200);
    ok('gerente: la recomendación pasa a «descartada»', /descartada/i.test(await texto(page)));
    if ((await boton(page, 'Aprobar').count()) >= 1) {
      const [apr] = await Promise.all([
        page.waitForResponse((r) => /recommendations\/.+\/approve/.test(r.url()), { timeout: 15000 }).catch(() => null),
        boton(page, 'Aprobar').first().click(),
      ]);
      ok('gerente: PATCH approve responde 200', apr?.status() === 200, String(apr?.status()));
      await page.waitForTimeout(1200);
      ok('gerente: la recomendación pasa a «aceptada»', /aceptada/i.test(await texto(page)));
    }
    // recarga: la decisión persiste
    await page.reload();
    await page.waitForLoadState('networkidle').catch(() => {});
    await rail(page, 'Recomendaciones').click();
    await page.waitForTimeout(1200);
    ok('gerente: las decisiones persisten tras recargar', /descartada|aceptada/i.test(await texto(page)));
  }
  ok('gerente: ningún 403/409 inesperado', !page.http.some((h) => /^(403|409)/.test(h)), page.http.join(' | '));
  ok('gerente: sin errores de página', page.errores.length === 0, page.errores.join(' | '));
  await ctx.close();
}

// --- Gerente: el resto de su menú sigue funcionando
{
  const { ctx, page } = await sesion(navegador, 'gerente');
  for (const m of ['Catálogo de productos', 'Aprobaciones', 'Reportes', 'Tiendas', 'Proveedores']) {
    await rail(page, m).click();
    await page.waitForTimeout(500);
    ok(`gerente: «${m}» abre sin error de página`, page.errores.length === 0);
  }
  await ctx.close();
}

// --- Analista: abrir una transacción
{
  const { ctx, page } = await sesion(navegador, 'analista');
  await rail(page, 'Transacciones').click();
  await page.waitForTimeout(1500);
  const filas = page.locator('button[aria-expanded]').filter({ hasText: /· (CSV|Manual)/ });
  const n = await filas.count();
  ok('analista/transacciones: hay filas clicables', n > 0, `filas=${n}`);
  if (n > 0) {
    await filas.first().click();
    ok('transacción: se abre con tienda, folio, total y líneas', await espera(page, /Total \$\d/));
    ok('transacción: GET /transactions/:id sin error', !page.http.some((h) => /transactions\/[0-9a-f-]{36}/.test(h)), page.http.join(' | '));
    ok('transacción: muestra al menos una línea con cantidad × precio', /\d+ × \$\d/.test(await texto(page)));
    await filas.first().click();
    await page.waitForTimeout(300);
    ok('transacción: se vuelve a cerrar', !/Total \$\d/.test(await texto(page).then((t) => t.replace(/\$\d+\.\d\d\s*(?=[A-Z])/g, ''))) || (await filas.first().getAttribute('aria-expanded')) === 'false');
  }
  ok('analista/transacciones: sin errores de página', page.errores.length === 0, page.errores.join(' | '));

  // --- Analista: accesibilidad con dos zonas
  await rail(page, 'Accesibilidad').click();
  await page.waitForTimeout(1000);
  const zonasA = await opcionesDe(page, 'acc-zona');
  const segs = await opcionesDe(page, 'acc-segmento');
  ok('accesibilidad: hay al menos 2 zonas y 1 segmento', zonasA.length >= 2 && segs.length >= 1, `zonas=${zonasA.length} segs=${segs.length}`);
  if (zonasA.length >= 2 && segs.length >= 1) {
    await elegir(page, 'acc-zona', zonasA[0]);
    const b = await opcionesDe(page, 'acc-zona-b');
    ok('accesibilidad: la zona A no aparece en el selector de comparación', !b.includes(zonasA[0]));
    await elegir(page, 'acc-zona-b', b[1]);
    await elegir(page, 'acc-segmento', segs[0]);
    await boton(page, 'Calcular').click();
    await page.waitForTimeout(3500);
    const tarjetas = await page.getByText('Costo de la canasta básica en la zona').count();
    ok('accesibilidad: comparan dos resultados lado a lado', tarjetas === 2, `tarjetas=${tarjetas}`);
    // sin comparación → una sola
    await elegir(page, 'acc-zona-b', 'Sin comparación');
    await boton(page, 'Calcular').click();
    await page.waitForTimeout(2500);
    ok('accesibilidad: sin zona B vuelve a un solo resultado', (await page.getByText('Costo de la canasta básica en la zona').count()) === 1);
  }
  ok('analista/accesibilidad: ningún 4xx/5xx inesperado', !page.http.some((h) => /^(4|5)\d\d .*accessibility/.test(h)), page.http.join(' | '));
  await ctx.close();
}

// --- Auditor: filtro por usuario en la bitácora
{
  const { ctx, page } = await sesion(navegador, 'auditor');
  await page.waitForTimeout(1200);
  const usuarios = await opcionesDe(page, 'bitacora-usuario');
  ok('bitácora: el selector de usuario lista usuarios', usuarios.length >= 3, `opciones=${usuarios.length}`);
  if (usuarios.length >= 2) {
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auditoria') && r.url().includes('usuarioId='), { timeout: 15000 }).catch(() => null),
      elegir(page, 'bitacora-usuario', usuarios[1]),
    ]);
    ok('bitácora: la petición lleva ?usuarioId=', !!resp && resp.status() === 200, String(resp?.status()));
    const total = resp ? (await resp.json()).total : -1;
    ok('bitácora: el filtro devuelve un total numérico', Number.isFinite(total), String(total));
    const acciones = await opcionesDe(page, 'bitacora-accion');
    if (acciones.length > 1) {
      const [r2] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/auditoria') && r.url().includes('accion='), { timeout: 15000 }).catch(() => null),
        elegir(page, 'bitacora-accion', acciones[1]),
      ]);
      ok('bitácora: usuario y operación se combinan', !!r2 && r2.url().includes('usuarioId=') && r2.status() === 200);
    }
    const [r3] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auditoria'), { timeout: 15000 }).catch(() => null),
      elegir(page, 'bitacora-usuario', 'Todos'),
    ]);
    ok('bitácora: «Todos» quita el filtro y no falla', !!r3 && !r3.url().includes('usuarioId=') && r3.status() === 200);
  }
  ok('auditor: sin errores de página', page.errores.length === 0, page.errores.join(' | '));
  await ctx.close();
}

await navegador.close();
process.exit(resumen('11 planeador, gerente y detalles') ? 1 : 0);
