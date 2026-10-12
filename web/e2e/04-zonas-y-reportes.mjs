// CAT-12/13 (indicadores y segmento de una zona, solo Analista) y DOC-03 (estadísticas de reportes por usuario y mes).
import { abrirNavegador, ok, resumen, sesion, rail, texto, espera } from './lib.mjs';

const navegador = await abrirNavegador();

{
  const { ctx, page } = await sesion(navegador, 'analista');
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

  await page.locator('button[aria-label^="Indicadores y segmento de "]').first().click();
  await page.getByRole('button', { name: 'Guardar segmento' }).click();
  ok('zona: segmento vacío se valida', await espera(page, /Elige el segmento/, 2000));
  await page.locator('[role=dialog] button', { hasText: 'Elige un segmento' }).first().click();
  await page.locator('[role=option]').nth(0).click();
  await page.getByRole('button', { name: 'Guardar segmento' }).click();
  ok('zona: clasifica en un segmento', await espera(page, /clasificada en el segmento/));
  ok('zona: sin errores JS', page.errores.length === 0, page.errores[0] ?? '');
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
