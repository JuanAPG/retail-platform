// Gráficas dinámicas con Highcharts: elasticidad (con selector zona/segmento), gasto por categoría y sustitución.
// Requiere al menos una corrida de elasticidad (la crea el Responsable de precios con «Calcular»).
import { abrirNavegador, ok, resumen, sesion, rail, texto, espera, json } from './lib.mjs';

const navegador = await abrirNavegador();
const graficas = (page) => page.locator('.highcharts-container');

{
  const { ctx, page } = await sesion(navegador, 'analista');

  // --- Elasticidad ---
  await rail(page, 'Elasticidad de precios').click();
  await page.waitForTimeout(800);
  // «Leche entera · 1 L» tiene resultados tras «Calcular» del Responsable de precios (seed + una corrida).
  await page.locator('button', { hasText: 'Elige una presentación' }).first().click();
  await page.locator('[role=option]', { hasText: 'Leche entera · 1 L' }).first().click();
  await page.locator('.highcharts-container').first().waitFor({ timeout: 15000 }).catch(() => {});
  ok('elasticidad: se dibuja la gráfica de Highcharts', (await graficas(page).count()) >= 1);
  ok('elasticidad: hay columnas', (await page.locator('.highcharts-column-series .highcharts-point').count()) >= 1);
  ok('elasticidad: marca la línea |E| = 1', (await page.locator('.highcharts-plot-line').count()) >= 1 && /\|E\| = 1/.test(await texto(page)));
  const colsZona = await page.locator('.highcharts-column-series .highcharts-point').count();
  await page.getByRole('button', { name: 'Por segmento' }).click();
  await page.waitForTimeout(1500);
  ok('elasticidad: cambiar a «Por segmento» redibuja la gráfica', (await graficas(page).count()) >= 1 || /Sin elasticidades/.test(await texto(page)), `columnas por zona: ${colsZona}`);
  await page.getByRole('button', { name: 'Por zona' }).click();
  await page.waitForTimeout(1200);
  await page.locator('.highcharts-point').first().hover().catch(() => {});
  ok('elasticidad: el tooltip muestra E y R²', await espera(page, /R² .* obs\./, 2500));

  ok('analista: sin errores JS con gráficas', page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}

// --- Gráficas con datos inyectados (no dependen del seed) ---
{
  const { ctx, page } = await sesion(navegador, 'analista');
  await page.route('**/localhost:3105/v1/substitution/patterns**', json([
    { originProductId: 'a', originProductName: 'Leche entera', targetProductId: 'b', targetProductName: 'Leche deslactosada', type: 'precio', score: 0.64, lift: 0.4, priceCorrelation: 0.52, observations: 18, summary: 'Indicio de sustitución por precio.', periodStart: '2026-08-05', periodEnd: '2026-08-15' },
    { originProductId: 'c', originProductName: 'Yogur', targetProductId: 'd', targetProductName: 'Queso', type: 'preferencia', score: 0.31, lift: 0.7, priceCorrelation: null, observations: 9, periodStart: '2026-08-05', periodEnd: '2026-08-15' },
  ]));
  await rail(page, 'Sustitución').click();
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: 'Elige una categoría' }).first().click();
  await page.locator('[role=option]').nth(0).click();
  await page.locator('.highcharts-container').first().waitFor({ timeout: 15000 }).catch(() => {});
  ok('sustitución: gráfica con una barra por indicio', (await page.locator('.highcharts-bar-series .highcharts-point').count()) === 2);
  ok('sustitución: muestra la frase de indicio', /Indicio de sustitución por precio/.test(await texto(page)));
  await ctx.close();
}
{
  const { ctx, page } = await sesion(navegador, 'analista');
  await page.route('**/localhost:3104/v1/analytics/spend-by-category**', json([
    { categoryId: 1, categoryName: 'Abarrotes', totalSpend: 520.5, units: 40, basketCount: 5, share: 71.2 },
    { categoryId: 2, categoryName: 'Lácteos', totalSpend: 210, units: 18, basketCount: 3, share: 28.8 },
  ]));
  await page.reload();
  await page.waitForLoadState('networkidle');
  // el paso «Indicadores» del encabezado del flujo
  const paso = page.locator('button', { hasText: 'Indicadores' }).first();
  await paso.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const ok1 = /Gasto por categoría/.test(await texto(page));
  if (ok1) {
    await graficas(page).first().waitFor({ timeout: 15000 }).catch(() => {});
    ok('gasto por categoría (datos inyectados): 2 barras', (await page.locator('.highcharts-bar-series .highcharts-point').count()) === 2);
  } else {
    ok('gasto por categoría: se pudo abrir el panel de indicadores', false, 'ver selector del paso Indicadores');
  }
  await ctx.close();
}
{
  // Las gráficas no deben tumbar la pantalla con datos basura.
  const { ctx, page } = await sesion(navegador, 'analista');
  await page.route('**/localhost:3105/v1/substitution/patterns**', json([{ originProductName: null, score: 'x', type: 'raro' }, null]));
  await rail(page, 'Sustitución').click();
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: 'Elige una categoría' }).first().click();
  await page.locator('[role=option]').nth(0).click();
  await page.waitForTimeout(2500);
  ok('sustitución con datos basura: la app no se cae', !(await texto(page)).includes('Algo salió mal'), page.errores[0] ?? '');
  await ctx.close();
}

await navegador.close();
process.exit(resumen('06 gráficas Highcharts') ? 1 : 0);
