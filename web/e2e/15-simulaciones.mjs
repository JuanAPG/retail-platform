// M13 — Las tres pantallas del Planeador contra la forma REAL de decision-service:
// lista de escenarios (paginada), comparar presentaciones (D-14: productId, >= 3) y
// comparar escenarios (`scenarios[].results`). Con el servicio real cuando hay datos;
// si la base no tiene escenarios ni precios suficientes, con respuestas que copian sus DTOs.
import { abrirNavegador, ok, resumen, sesion, rail, espera, json } from './lib.mjs';

const navegador = await abrirNavegador();
const AHORA = new Date().toISOString();

// Forma de `ScenarioSummary` / `ScenarioPage` (decision-service/src/simulation/dto/scenario-summary.dto.ts).
const escenario = (id, name, type, extra = {}) => ({
  id, name, type, zoneId: null, productId: 'p-1', presentationId: null, elasticity: -1.2, elasticityRunId: null,
  currentPrice: 25, newPrice: 27.5, baseDemand: 1000, presentations: [], assumptions: [], createdBy: 'u-1', createdAt: AHORA, ...extra,
});
const pagina = { data: [escenario('esc-a', 'Cambio de precio - Leche 1 L', 'precio'), escenario('esc-b', 'Presentaciones - Arroz', 'presentacion')], total: 2, page: 1, limit: 100 };

// Forma de `ScenarioComparison` (scenario-comparison.dto.ts).
const comparacion = {
  scenarioIds: ['esc-a', 'esc-b'],
  scenarios: [
    { scenarioId: 'esc-a', name: 'Cambio de precio - Leche 1 L', type: 'precio', zoneId: null, elasticity: -2, elasticityRunId: 'r-1',
      results: [
        { indicatorKey: 'demanda_estimada', zoneId: null, baseValue: 1000, simulatedValue: 826, difference: -174, variationPct: -17.4 },
        { indicatorKey: 'ingreso_estimado', zoneId: null, baseValue: 25000, simulatedValue: 22715, difference: -2285, variationPct: -9.14 },
      ] },
    { scenarioId: 'esc-b', name: 'Presentaciones - Arroz', type: 'presentacion', zoneId: null, elasticity: null, elasticityRunId: null,
      results: [{ indicatorKey: 'demanda_estimada', zoneId: null, baseValue: 500, simulatedValue: 540, difference: 40, variationPct: 8 }] },
  ],
  warnings: ['El escenario esc-b no tiene elasticidad.'],
};

// Forma de `PresentationComparisonResult` (presentation-comparison-result.dto.ts).
const presentaciones = {
  type: 'presentacion', scenarioId: 'esc-n', productId: 'p-1', productName: 'Queso panela', zoneId: null, segmentId: null,
  presentations: [
    { presentationId: 'pr-1', presentationName: '200 g', priceStatus: 'con_precio', outlay: 32.5, unitPrice: 162.5, baseUnit: 'kg', estimatedDemand: 120, accessibilityEffect: { incomeSharePct: 0.43, unitPricePremiumPct: 8.3 } },
    { presentationId: 'pr-2', presentationName: '400 g', priceStatus: 'con_precio', outlay: 60, unitPrice: 150, baseUnit: 'kg', estimatedDemand: 80, accessibilityEffect: { incomeSharePct: 0.8, unitPricePremiumPct: 0 } },
    { presentationId: 'pr-3', presentationName: '1 kg', priceStatus: 'sin_precio_vigente', outlay: null, unitPrice: null, baseUnit: 'kg', estimatedDemand: null, accessibilityEffect: null },
  ],
  referencePresentationId: 'pr-2', comparedPresentationId: 'pr-1',
  results: [], assumptions: ['Precio promedio vigente a nivel nacional.'], warnings: ['1 kg no tiene precio vigente: se muestra sin valores.'],
};

const { ctx, page } = await sesion(navegador, 'planeador');

// 1) Historial con el servicio real: la página paginada ya no rompe la pantalla.
await rail(page, 'Historial').click();
ok('historial: con el servicio real carga sin error', await espera(page, /Aún no has ejecutado ninguna simulación|Selecciona 2 o más/, 8000));

// 2) Historial y comparación con la forma de los DTOs.
await page.route('**/v1/simulation/scenarios**', json(pagina));
await page.route('**/v1/simulation/compare**', json(comparacion));
await rail(page, 'Nueva simulación').click();
await rail(page, 'Historial').click();
ok('historial: muestra el nombre y el tipo de cada escenario', await espera(page, /Cambio de precio - Leche 1 L/, 6000) && (await espera(page, /Presentaciones · Nacional/, 2000)));
await page.getByText('Cambio de precio - Leche 1 L').click();
await page.getByText('Presentaciones - Arroz').click();
await page.getByRole('button', { name: /Comparar 2 seleccionados/ }).click();
await page.waitForSelector('table thead', { timeout: 6000 });
const encabezado = (await page.locator('table thead').first().innerText()).toLowerCase();
ok('comparar escenarios: columnas con el nombre de cada escenario', encabezado.includes('cambio de precio - leche 1 l') && encabezado.includes('presentaciones - arroz'), encabezado.replace(/\s+/g, ' '));
ok('comparar escenarios: valor simulado con su variación (caso de control 826)', await espera(page, /826/, 3000));
const textoTabla = await page.locator('table').first().innerText();
ok('comparar escenarios: un indicador que el escenario no calculó sale "—", no 0', /—/.test(textoTabla), textoTabla.replace(/\s+/g, ' ').slice(0, 200));
ok('comparar escenarios: muestra los avisos del servicio', await espera(page, /no tiene elasticidad/, 2000));

// 3) Comparar presentaciones: se elige el PRODUCTO (D-14) y se manda productId.
await rail(page, 'Nueva simulación').click();
await page.getByRole('button', { name: 'Comparar presentaciones' }).click();
await page.locator('#sim-producto').click();
const opciones = await page.locator('[role=option]').allInnerTexts();
ok('presentaciones: lista productos con 3 o más presentaciones', opciones.length > 0 && opciones.every((o) => /\d+ presentaciones/.test(o)), opciones.join(' | '));
await page.locator('[role=option]').first().click();
const pedido = page.waitForRequest((r) => r.url().includes('/v1/simulation/presentation') && r.method() === 'POST');
await page.getByRole('button', { name: 'Simular' }).click();
const cuerpo = (await pedido).postDataJSON();
ok('presentaciones: manda productId (no presentationIdA/B)', typeof cuerpo.productId === 'string' && !('presentationIdA' in cuerpo), JSON.stringify(cuerpo));
// Con el servicio real puede ser 404 (menos de 3 presentaciones con precio): el mensaje se muestra tal cual.
await page.waitForTimeout(1500);
const real = await page.locator('form').innerText();
ok('presentaciones: con el servicio real responde o explica por qué no', /presentaciones|precio/i.test(real) || (await page.locator('[data-testid=comparacion-presentaciones]').count()) === 1);

await page.route('**/v1/simulation/presentation', json(presentaciones, 201));
await page.getByRole('button', { name: 'Simular' }).click();
ok('presentaciones: muestra la tabla del producto', await espera(page, /Presentaciones de Queso panela/, 6000));
const tabla = await page.locator('[data-testid=comparacion-presentaciones]').innerText();
ok('presentaciones: precio por unidad base y referencia', /\$150.*\/ kg/.test(tabla.replace(/\s+/g, ' ')) && /referencia/.test(tabla));
ok('presentaciones: sin precio vigente sale "—", nunca 0', /Sin precio vigente/.test(tabla) && !/\$0(\D|$)/.test(tabla));
ok('presentaciones: avisos y supuestos visibles', /no tiene precio vigente/.test(tabla) && /nivel nacional/.test(tabla));

ok('sin errores JS', page.errores.length === 0, page.errores[0] ?? '');
await ctx.close();
await navegador.close();
process.exit(resumen('15 simulaciones (M13)') ? 1 : 0);
