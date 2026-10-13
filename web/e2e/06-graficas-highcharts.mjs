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

// --- Interruptor de tipo de gráfica (elasticidad y sustitución) ---
{
  const { ctx, page } = await sesion(navegador, 'analista');
  const tipo = (nombre) => page.getByRole('button', { name: nombre, exact: true });

  await rail(page, 'Elasticidad de precios').click();
  await page.waitForTimeout(600);
  await page.locator('button', { hasText: 'Elige una presentación' }).first().click();
  await page.locator('[role=option]', { hasText: 'Leche entera · 1 L' }).first().click();
  await page.locator('.highcharts-container').first().waitFor({ timeout: 15000 });
  ok('elasticidad: el interruptor ofrece 3 tipos arriba a la derecha', (await page.locator('[role=group][aria-label^="Tipo de gráfica de elasticidad"] button').count()) === 3);
  ok('elasticidad: empieza en Columnas', (await tipo('Columnas').getAttribute('aria-pressed')) === 'true' && (await page.locator('.highcharts-column-series .highcharts-point').count()) >= 1);
  await tipo('Barras ordenadas').click();
  await page.waitForTimeout(900);
  ok('elasticidad: «Barras ordenadas» dibuja barras horizontales', (await page.locator('.highcharts-bar-series .highcharts-point').count()) >= 1 && (await page.locator('.highcharts-column-series').count()) === 0 && (await tipo('Barras ordenadas').getAttribute('aria-pressed')) === 'true');
  ok('elasticidad: «Telaraña» se deshabilita con menos de 3 zonas con dato', await tipo('Telaraña').isDisabled());
  await tipo('Columnas').click();
  await page.waitForTimeout(900);
  ok('elasticidad: volver a «Columnas» redibuja', (await page.locator('.highcharts-column-series .highcharts-point').count()) >= 1);
  ok('elasticidad: el interruptor no rompe nada', page.errores.length === 0, page.errores[0] ?? '');

  const barra = (key, label, value, classification) => ({ key, label, value, classification, observations: 6, rSquared: 0.4 });
  await page.route('**/localhost:3105/v1/elasticity/chart**', json({
    runId: 'r', presentationId: 'p', productName: 'Leche', presentationName: '1 L', groupBy: 'zone', executedAt: '2026-10-12T19:00:00Z', granularity: 'day',
    periodStart: '2026-08-05', periodEnd: '2026-08-14', note: 'datos de prueba',
    bars: [barra('a', 'Centro', -2.1, 'elastic'), barra('b', 'Oriente', -0.6, 'inelastic'), barra('c', 'Valle', -1.0, 'unitary'), barra('d', 'Norte', -1.8, 'elastic')],
    national: { value: -1.4, classification: 'elastic', observations: 24, rSquared: 0.5 },
  }));
  await rail(page, 'Transacciones').click();
  await rail(page, 'Elasticidad de precios').click();
  await page.waitForTimeout(600);
  await page.locator('button', { hasText: 'Elige una presentación' }).first().click();
  await page.locator('[role=option]', { hasText: 'Leche entera · 1 L' }).first().click();
  await page.locator('.highcharts-container').first().waitFor({ timeout: 15000 });
  ok('elasticidad: con ≥ 3 zonas con dato «Telaraña» se habilita', await tipo('Telaraña').isEnabled());
  await tipo('Telaraña').click();
  await page.waitForTimeout(900);
  ok('elasticidad: «Telaraña» dibuja la gráfica polar', (await page.locator('.highcharts-polar-series .highcharts-point, .highcharts-area-series').count()) >= 1 && (await page.locator('.highcharts-column-series, .highcharts-bar-series').count()) === 0);

  await page.route('**/localhost:3105/v1/substitution/patterns**', json([
    { originProductId: 'a', originProductName: 'Leche entera', targetProductId: 'b', targetProductName: 'Leche deslactosada', type: 'precio', score: 0.64, lift: 0.4, priceCorrelation: 0.52, observations: 18, periodStart: '2026-08-05', periodEnd: '2026-08-15' },
    { originProductId: 'c', originProductName: 'Yogur', targetProductId: 'd', targetProductName: 'Queso', type: 'preferencia', score: 0.31, lift: 0.7, priceCorrelation: null, observations: 9, periodStart: '2026-08-05', periodEnd: '2026-08-15' },
    { originProductId: 'e', originProductName: 'Pan', targetProductId: 'f', targetProductName: 'Tortilla', type: 'precio', score: 0.5, lift: 0.55, priceCorrelation: 0.4, observations: 12, periodStart: '2026-08-05', periodEnd: '2026-08-15' },
  ]));
  await rail(page, 'Sustitución').click();
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: 'Elige una categoría' }).first().click();
  await page.locator('[role=option]').nth(0).click();
  await page.locator('.highcharts-container').first().waitFor({ timeout: 15000 });
  ok('sustitución: el interruptor ofrece 3 tipos', (await page.locator('[role=group][aria-label^="Tipo de gráfica de sustitución"] button').count()) === 3);
  ok('sustitución: empieza en Barras con 3 barras', (await page.locator('.highcharts-bar-series .highcharts-point').count()) === 3);
  await tipo('Burbujas').click();
  await page.waitForTimeout(900);
  ok('sustitución: «Burbujas» dibuja 3 burbujas', (await page.locator('.highcharts-bubble-series .highcharts-point').count()) === 3);
  await tipo('Dona').click();
  await page.waitForTimeout(900);
  ok('sustitución: «Dona» dibuja 2 sectores (precio y preferencia)', (await page.locator('.highcharts-pie-series .highcharts-point').count()) === 2);
  ok('sustitución: el interruptor no rompe nada', page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}

// --- Interruptor de tipo de gráfica: gasto por categoría ---
{
  const { ctx, page } = await sesion(navegador, 'analista');
  await page.route('**/localhost:3104/v1/analytics/spend-by-category**', json([
    { categoryId: 1, categoryName: 'Abarrotes', totalSpend: 5856, units: 133, basketCount: 71, share: 50.9 },
    { categoryId: 2, categoryName: 'Lácteos', totalSpend: 3645, units: 176, basketCount: 66, share: 31.7 },
    { categoryId: 3, categoryName: 'Bebidas', totalSpend: 2000, units: 90, basketCount: 40, share: 17.4 },
  ]));
  await rail(page, 'Indicadores y gráficas').click();
  await page.locator('.highcharts-container').first().waitFor({ timeout: 15000 });
  const tipo = (n) => page.getByRole('button', { name: n, exact: true });
  ok('gasto: el interruptor ofrece 4 tipos', (await page.locator('[role=group][aria-label^="Tipo de gráfica de gasto"] button').count()) === 4);
  ok('gasto: empieza en Barras con 3 barras', (await page.locator('.highcharts-bar-series .highcharts-point').count()) === 3);
  await tipo('Columnas').click(); await page.waitForTimeout(900);
  ok('gasto: «Columnas» dibuja 3 columnas', (await page.locator('.highcharts-column-series .highcharts-point').count()) === 3);
  await tipo('Dona').click(); await page.waitForTimeout(900);
  ok('gasto: «Dona» dibuja 3 sectores', (await page.locator('.highcharts-pie-series .highcharts-point').count()) === 3);
  await tipo('Mapa de árbol').click(); await page.waitForTimeout(1200);
  ok('gasto: «Mapa de árbol» dibuja 3 bloques', (await page.locator('.highcharts-treemap-series .highcharts-point').count()) === 3);
  ok('gasto: el interruptor no rompe nada', page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}

await navegador.close();
process.exit(resumen('06 gráficas Highcharts') ? 1 : 0);
