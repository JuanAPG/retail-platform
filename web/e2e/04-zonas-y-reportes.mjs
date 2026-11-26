// CAT-12/13 (indicadores y segmento de una zona, solo Administrador por la Matriz §3) y DOC-03
// (estadísticas de reportes por usuario y mes).
import { abrirNavegador, ok, resumen, sesion, rail, texto, espera } from './lib.mjs';

const navegador = await abrirNavegador();

{
  // Zonas (M03) las escribe el Administrador: el Analista ya no ve estos botones.
  const { ctx, page } = await sesion(navegador, 'admin');
  await rail(page, 'Zonas').click();
  await page.waitForTimeout(800);
  await page.locator('button[aria-label^="Indicadores y segmento de "]').first().click();
  ok('zona: abre el modal de indicadores y segmento', (await page.locator('[role=dialog]').count()) === 1);

  await page.getByRole('button', { name: 'Guardar indicadores' }).click();
  ok('zona: indicadores vacíos se validan', await espera(page, /ingreso estimado debe ser/, 2000));
  await page.fill('#zd-ingreso', '18500');
  await page.fill('#zd-poblacion', '42000');
  await page.fill('#zd-disp', '1.5');
  await page.getByRole('button', { name: 'Guardar indicadores' }).click();
  ok('zona: disponibilidad fuera de 0..1 se valida', await espera(page, /entre 0 y 1/, 2000));
  await page.fill('#zd-disp', '0.85');
  await page.fill('#zd-desde', '2026-01-01');
  await page.fill('#zd-hasta', '2026-09-30');
  await page.getByRole('button', { name: 'Guardar indicadores' }).click();
  ok('zona: la fuente es obligatoria', await espera(page, /fuente es obligatoria/, 2000));
  await page.fill('#zd-fuente', 'INEGI - Censo 2020');
  await page.getByRole('button', { name: 'Guardar indicadores' }).click();
  ok('zona: guarda los indicadores', await espera(page, /Indicadores de .* guardados/));

  // D-35 / Matriz §3.2: el Administrador ya no clasifica (Lectura en income-segmentation).
  await page.locator('button[aria-label^="Indicadores y segmento de "]').first().click();
  ok('zona: el Administrador no ve la sección de segmento', (await page.getByRole('button', { name: 'Guardar segmento' }).count()) === 0);
  ok('zona: sin errores JS', page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}
{
  // La clasificación la hace el Analista comercial en income-segmentation-service (3112).
  const { ctx, page } = await sesion(navegador, 'analista');
  await rail(page, 'Zonas').click();
  await page.waitForTimeout(800);
  ok('zona: el Analista no ve indicadores, editar ni eliminar', (await page.locator('button[aria-label^="Indicadores y segmento de "]').count()) === 0);
  await page.locator('button[aria-label^="Segmento de "]').first().click();
  ok('zona: el Analista no ve la carga de indicadores', (await page.getByRole('button', { name: 'Guardar indicadores' }).count()) === 0);
  await page.getByRole('button', { name: 'Guardar segmento' }).click();
  ok('zona: segmento vacío se valida', await espera(page, /Elige el segmento/, 2000));
  const respuesta = page.waitForResponse((r) => /\/v1\/zones\/[^/]+\/classification$/.test(r.url()) && r.request().method() === 'PUT');
  await page.locator('[role=dialog] button', { hasText: 'Elige un segmento' }).first().click();
  await page.locator('[role=option]').nth(0).click();
  await page.getByRole('button', { name: 'Guardar segmento' }).click();
  const r = await respuesta;
  ok('zona: la clasificación va a income-segmentation (3112)', r.url().includes(':3112/') && r.status() === 200, `${r.status()} ${r.url()}`);
  ok('zona: clasifica en un segmento', await espera(page, /clasificada en el segmento/));
  ok('zona: sin errores JS (Analista)', page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}
{
  const { ctx, page } = await sesion(navegador, 'gerente');
  await rail(page, 'Reportes').click();
  ok('reportes: muestra las estadísticas por usuario y mes', await espera(page, /Reportes por usuario y mes/));
  ok('reportes: la tabla trae filas o dice que no hay', await espera(page, /Todavía no hay reportes que contar|Mes Usuario Reportes/));
  await ctx.close();
}

await navegador.close();
process.exit(resumen('04 zonas y reportes') ? 1 : 0);
