// D-39 / T-24 — El Gerente propone promociones desde la web contra promotion-service (3115) real.
import { abrirNavegador, ok, resumen, sesion, rail, espera } from './lib.mjs';

const navegador = await abrirNavegador();
const marca = Date.now().toString().slice(-6);
const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const enDiez = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

{
  const { ctx, page } = await sesion(navegador, 'analista');
  ok('promociones: el Analista no ve el módulo', (await rail(page, 'Promociones').count()) === 0);
  await ctx.close();
}

const { ctx, page } = await sesion(navegador, 'gerente');
await rail(page, 'Promociones').click();
ok('promociones: abre el módulo del Gerente', await espera(page, /Propón descuentos, paquetes/, 8000));
ok('promociones: la lista carga (o dice que no hay)', await espera(page, /Todavía no hay promociones|Pendiente|Aprobada|Rechazada/, 8000));

const panel = page.locator('[data-testid=panel-promociones]');
const selects = panel.locator('select');
await panel.locator('input').first().fill(`E2E descuento ${marca}`);
await selects.nth(0).selectOption({ index: 1 });
await selects.nth(1).selectOption({ index: 1 });
await selects.nth(3).selectOption({ index: 1 });
await panel.locator('input[type=number]').first().fill('10');
const fechas = panel.locator('input[type=date]');
await fechas.nth(0).fill(enDiez);
await fechas.nth(1).fill(manana);
await page.getByRole('button', { name: 'Proponer promoción' }).click();
ok('promociones: vigencia invertida se valida en la web', await espera(page, /no puede ser anterior/, 3000));

await fechas.nth(0).fill(manana);
await fechas.nth(1).fill(enDiez);
const respuesta = page.waitForResponse((r) => r.url().includes('/v1/promotions') && r.request().method() === 'POST');
await page.getByRole('button', { name: 'Proponer promoción' }).click();
const r = await respuesta;
const cuerpo = r.request().postDataJSON();
ok('promociones: POST 201 al servicio real', r.status() === 201, String(r.status()));
ok('promociones: manda solo los campos del tipo (sin pack* ni promo*)', cuerpo.discountPct === 10 && !('packPrice' in cuerpo) && !('promoPrice' in cuerpo) && ('zoneId' in cuerpo) !== ('storeId' in cuerpo), JSON.stringify(cuerpo));
ok('promociones: confirma que queda pendiente', await espera(page, /queda pendiente de que el Responsable de precios/, 6000));
ok('promociones: aparece en la lista como Pendiente', await espera(page, new RegExp(`E2E descuento ${marca}.*Pendiente`), 6000));

ok('promociones: sin errores JS', page.errores.length === 0, page.errores[0] ?? '');
await ctx.close();
await navegador.close();
process.exit(resumen('16 promociones (D-39)') ? 1 : 0);
