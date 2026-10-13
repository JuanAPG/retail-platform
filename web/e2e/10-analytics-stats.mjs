// RF-16 y RF-20 a RF-22 contra analytics-stats real (requiere el servicio arriba en :3106 y las ventas de db/datos_prueba_*.csv).
import { abrirNavegador, ok, resumen, sesion, rail, texto, espera, json } from './lib.mjs';

const navegador = await abrirNavegador();
const corre = (page) => page.getByRole('button', { name: 'Correr prueba' });
const pestana = (page, nombre) => page.getByRole('tab', { name: nombre });
const chip = (page, nombre) => page.locator('label', { hasText: nombre }).first();
const tipo = (page, n) => page.getByRole('button', { name: n, exact: true });

// ---------- Pruebas estadísticas ----------
{
  const { ctx, page } = await sesion(navegador, 'analista');
  await rail(page, 'Pruebas estadísticas').click();
  await page.waitForTimeout(800);
  ok('estadística: se ven las 3 pruebas', (await page.getByRole('tab').count()) === 3);

  // Hipótesis (2 grupos) desde canastas
  await corre(page).click();
  ok('hipótesis: sin grupos pide elegirlos', await espera(page, /Elige al menos 2/, 2000));
  await chip(page, 'Zona Centro').click();
  await chip(page, 'Zona Valle').click();
  await chip(page, 'Zona Oriente').click();
  await corre(page).click();
  ok('hipótesis: con 3 grupos avisa que compara máximo 2', await espera(page, /como máximo 2 grupos/, 2000));
  await chip(page, 'Zona Oriente').click();
  await page.fill('input[type=number][step="0.01"]', '1.5');
  await corre(page).click();
  ok('hipótesis: α fuera de 0 a 1 se valida', await espera(page, /entre 0 y 1/, 2000));
  await page.fill('input[type=number][step="0.01"]', '0.05');
  await corre(page).click();
  ok('hipótesis: corre y da una conclusión', await espera(page, /diferencia estadística|Sin evidencia suficiente/, 20000));
  ok('hipótesis: muestra p-value y la prueba', /p = /.test(await texto(page)) && /welch|mannwhitney/i.test(await texto(page)));
  await page.locator('.highcharts-container').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  ok('hipótesis: dibuja medias ± desviación', (await page.locator('.highcharts-column-series .highcharts-point').count()) >= 2 && (await page.locator('.highcharts-errorbar-series').count()) >= 1);
  await tipo(page, 'Media y mediana').click();
  await page.waitForTimeout(900);
  ok('hipótesis: «Media y mediana» dibuja 2 series', (await page.locator('.highcharts-column-series').count()) >= 2);

  // ANOVA (3 zonas) desde canastas
  await pestana(page, /ANOVA/).click();
  await page.waitForTimeout(400);
  ok('anova: cambiar de prueba limpia el resultado', !(await texto(page)).includes('Hay diferencia estadística') && (await page.locator('.highcharts-container').count()) === 0);
  for (const z of ['Zona Centro', 'Zona Oriente', 'Zona Valle']) await chip(page, z).click();
  await corre(page).click();
  ok('anova: corre con 3 zonas', await espera(page, /anova/i, 20000) && (await page.locator('.highcharts-column-series .highcharts-point').count()) >= 3);
  ok('anova: dice qué supone la prueba', (await page.getByText('Qué supone esta prueba').count()) === 1);

  // Proporciones
  await pestana(page, /Proporciones/).click();
  await page.waitForTimeout(400);
  for (const z of ['Zona Centro', 'Zona Oriente']) await chip(page, z).click();
  await corre(page).click();
  ok('proporciones: corre y trae la tabla de grupos', await espera(page, /Proporción/, 20000));
  ok('proporciones: dibuja columnas', (await page.locator('.highcharts-column-series .highcharts-point').count()) === 2);
  await tipo(page, 'Dona').click();
  await page.waitForTimeout(900);
  ok('proporciones: «Dona» dibuja 2 sectores', (await page.locator('.highcharts-pie-series .highcharts-point').count()) === 2);
  await tipo(page, 'Barras').click();
  await page.waitForTimeout(900);
  ok('proporciones: «Barras» dibuja barras', (await page.locator('.highcharts-bar-series .highcharts-point').count()) === 2);

  // Valores escritos a mano
  await pestana(page, /Hipótesis/).click();
  await page.getByRole('button', { name: 'Escribir los valores' }).click();
  await corre(page).click();
  ok('manual: valores vacíos se validan', await espera(page, /no son números|al menos 2 valores/, 2000));
  const cajas = page.locator('textarea');
  await cajas.nth(0).fill('10, 12, 11, 13, 12.5, 11.8, 12.2, 10.9, 11.4');
  await cajas.nth(1).fill('20 22 21 23 22.5 21.8 22.2 20.9 21.4');
  await corre(page).click();
  ok('manual: con valores claramente distintos rechaza H0', await espera(page, /Hay diferencia estadística/, 20000));
  await cajas.nth(1).fill('20 abc 21');
  await corre(page).click();
  ok('manual: un valor no numérico se avisa', await espera(page, /no son números/, 2000));
  ok('estadística: sin errores JS', page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}

// ---------- Rol sin permiso ----------
{
  const { ctx, page } = await sesion(navegador, 'admin');
  await page.goto('http://localhost:5173/analista');
  await page.waitForLoadState('networkidle');
  await rail(page, 'Pruebas estadísticas').click();
  await page.waitForTimeout(500);
  ok('estadística: el Administrador ve la nota y no el formulario', /Solo el Analista comercial corre pruebas/.test(await texto(page)) && (await corre(page).count()) === 0);
  await rail(page, 'Agrupación de zonas').click();
  await page.waitForTimeout(800);
  ok('agrupación: el Administrador ve la nota y no el formulario', /Solo el Analista comercial corre agrupaciones/.test(await texto(page)) && (await page.getByRole('button', { name: 'Agrupar zonas' }).count()) === 0);
  await ctx.close();
}

// ---------- Errores del servicio ----------
{
  const { ctx, page } = await sesion(navegador, 'analista');
  await rail(page, 'Pruebas estadísticas').click();
  await page.waitForTimeout(600);
  await chip(page, 'Zona Centro').click();
  await chip(page, 'Zona Valle').click();
  await page.route('**/localhost:3106/v1/hypothesis/test', json({ statusCode: 503, message: 'core-process-service no respondió en 3 s.', code: 'SERVICE_UNAVAILABLE', details: null }, 503));
  await corre(page).click();
  ok('error 503 del servicio: mensaje claro y la pantalla sigue', await espera(page, /no respondió|no está disponible/i, 5000) && !(await texto(page)).includes('Algo salió mal'));
  await page.unroute('**/localhost:3106/v1/hypothesis/test');
  await page.route('**/localhost:3106/v1/hypothesis/test', json({ statusCode: 400, message: 'Un grupo tiene menos de 2 canastas.', code: 'VALIDATION_ERROR', details: ['Zona Valle: 1 canasta'] }, 400));
  await corre(page).click();
  ok('error 400: muestra el motivo y el detalle', await espera(page, /menos de 2 canastas/, 5000));
  await page.unroute('**/localhost:3106/v1/hypothesis/test');
  await page.route('**/localhost:3106/v1/hypothesis/test', json({ test: 'welch', pValue: 'basura', conclusion: null, groups: null, assumptions: null }));
  await corre(page).click();
  await page.waitForTimeout(1500);
  ok('respuesta corrupta: la app no se cae', !(await texto(page)).includes('Algo salió mal') && page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}

// ---------- Agrupación de zonas ----------
{
  const { ctx, page } = await sesion(navegador, 'analista');
  await rail(page, 'Agrupación de zonas').click();
  await page.waitForTimeout(800);
  await page.fill('input[type=number][min="2"]', '1');
  await page.getByRole('button', { name: 'Agrupar zonas' }).click();
  ok('clustering: k fuera de rango se valida', await espera(page, /entero de 2 a 10/, 2000));
  await page.fill('input[type=number][min="2"]', '3');
  await page.getByRole('button', { name: 'Agrupar zonas' }).click();
  ok('clustering: k = 3 con 3 zonas muestra el límite D-27 del servicio', await espera(page, /menor que el número de zonas|D-27/, 20000));
  await page.fill('input[type=number][min="2"]', '2');
  await page.getByRole('button', { name: 'Agrupar zonas' }).click();
  ok('clustering: k = 2 corre y muestra los grupos', await espera(page, /2 grupos/, 20000));
  await page.locator('.highcharts-container').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  ok('clustering: dibuja la dispersión (un punto por zona)', (await page.locator('.highcharts-container .highcharts-point').count()) >= 3);
  await tipo(page, 'Perfil de grupos').click();
  await page.waitForTimeout(900);
  ok('clustering: «Perfil de grupos» dibuja columnas por grupo', (await page.locator('.highcharts-column-series').count()) >= 2);
  await tipo(page, 'Tamaño').click();
  await page.waitForTimeout(900);
  ok('clustering: «Tamaño» dibuja la dona', (await page.locator('.highcharts-pie-series .highcharts-point').count()) === 2);
  ok('clustering: la corrida queda en el historial', (await page.getByText(/k = 2 ·/).count()) >= 1);
  // reabrir una corrida guardada
  await page.getByText(/k = 2 ·/).first().click();
  ok('clustering: reabrir una corrida guardada la muestra', await espera(page, /2 grupos/, 8000));
  ok('clustering: sin errores JS', page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}

await navegador.close();
process.exit(resumen('10 analytics-stats') ? 1 : 0);
