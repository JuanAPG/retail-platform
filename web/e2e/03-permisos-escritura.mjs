// QA-WEB64-01: el web no ofrece escrituras que el backend rechaza con 403 (tiendas: Gerente; zonas: Analista).
import { abrirNavegador, ok, resumen, sesion, rail, texto } from './lib.mjs';

const navegador = await abrirNavegador();
const boton = (page, nombre) => page.getByRole('button', { name: nombre });

{
  const { ctx, page } = await sesion(navegador, 'admin');
  await rail(page, 'Tiendas').click();
  await page.waitForTimeout(800);
  ok('admin/tiendas: sin «Nueva tienda»', (await boton(page, 'Nueva tienda').count()) === 0);
  ok('admin/tiendas: sin editar ni eliminar', (await page.locator('button[aria-label^="Editar "], button[aria-label^="Eliminar "]').count()) === 0);
  ok('admin/tiendas: el interruptor activo/inactivo está deshabilitado', (await page.locator('[role=switch]:not([disabled])').count()) === 0);
  ok('admin/tiendas: explica que es de solo lectura', /solo lectura/i.test(await texto(page)));
  await rail(page, 'Zonas').click();
  await page.waitForTimeout(800);
  ok('admin/zonas: sin «Nueva zona»', (await boton(page, 'Nueva zona').count()) === 0);
  ok('admin/zonas: sin editar ni eliminar', (await page.locator('button[aria-label^="Editar "], button[aria-label^="Eliminar "]').count()) === 0);
  ok('admin/zonas: conserva «Comparar zonas»', (await boton(page, 'Comparar zonas').count()) === 1);
  ok('admin: ningún 403 al recorrer tiendas y zonas', !page.http.some((h) => h.startsWith('403')), page.http.join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await sesion(navegador, 'gerente');
  await rail(page, 'Tiendas').click();
  await page.waitForTimeout(800);
  ok('gerente/tiendas: puede crear, editar y eliminar', (await boton(page, 'Nueva tienda').count()) === 1 && (await page.locator('button[aria-label^="Editar "]').count()) > 0);
  await ctx.close();
}
{
  const { ctx, page } = await sesion(navegador, 'analista');
  await rail(page, 'Zonas').click();
  await page.waitForTimeout(800);
  ok('analista/zonas: existe el módulo y puede crear y editar', (await boton(page, 'Nueva zona').count()) === 1 && (await page.locator('button[aria-label^="Editar "]').count()) > 0);
  await boton(page, 'Comparar zonas').click();
  await page.waitForTimeout(600);
  ok('analista/zonas: la comparación abre', /comparar|Comparación/i.test(await texto(page)));
  await ctx.close();
}

await navegador.close();
process.exit(resumen('03 permisos de escritura') ? 1 : 0);
