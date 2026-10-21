// QA-WEB64-02 (resuelto): el web no ofrece escrituras que el backend rechaza con 403.
// Tiendas (M02) y zonas (M03) las escribe SOLO el Administrador (Matriz §3); el Gerente
// de categoría y el Analista comercial pasaron a solo lectura en esos dos módulos.
import { abrirNavegador, ok, resumen, sesion, rail, texto } from './lib.mjs';

const navegador = await abrirNavegador();
const boton = (page, nombre) => page.getByRole('button', { name: nombre });
const editarOEliminar = (page) =>
  page.locator('button[aria-label^="Editar "], button[aria-label^="Eliminar "]');

{
  const { ctx, page } = await sesion(navegador, 'admin');
  await rail(page, 'Tiendas').click();
  await page.waitForTimeout(800);
  ok('admin/tiendas: ofrece «Nueva tienda»', (await boton(page, 'Nueva tienda').count()) === 1);
  ok('admin/tiendas: ofrece editar y eliminar', (await editarOEliminar(page).count()) > 0);
  ok('admin/tiendas: el interruptor activo/inactivo está habilitado', (await page.locator('[role=switch]:not([disabled])').count()) > 0);
  ok('admin/tiendas: NO dice que es de solo lectura', !/solo lectura/i.test(await texto(page)));

  await rail(page, 'Zonas').click();
  await page.waitForTimeout(800);
  ok('admin/zonas: ofrece «Nueva zona»', (await boton(page, 'Nueva zona').count()) === 1);
  ok('admin/zonas: ofrece editar y eliminar', (await editarOEliminar(page).count()) > 0);
  ok('admin/zonas: conserva «Comparar zonas»', (await boton(page, 'Comparar zonas').count()) === 1);
  ok('admin: ningún 403 al recorrer tiendas y zonas', !page.http.some((h) => h.startsWith('403')), page.http.join(' | '));
  await ctx.close();
}
{
  // M06/M07: el Administrador es Lectura. Entra al portal del Analista con
  // «Ver como» (SelectorDePortal), así que ahí tampoco se le ofrece escribir.
  const { ctx, page } = await sesion(navegador, 'admin');
  await page.getByLabel('Cambiar de portal').selectOption('/analista');
  await page.waitForTimeout(800);
  await rail(page, 'Transacciones').click();
  await page.waitForTimeout(800);
  ok('admin/transacciones: sin «Importar CSV»', (await boton(page, 'Importar CSV').count()) === 0);
  ok('admin/transacciones: sin «Nueva transacción»', (await boton(page, 'Nueva transacción').count()) === 0);
  ok('admin/transacciones: explica que es de solo lectura', /solo lectura/i.test(await texto(page)));
  ok('admin/transacciones: la lista carga sin 403', !page.http.some((h) => h.startsWith('403')), page.http.join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await sesion(navegador, 'analista');
  await rail(page, 'Transacciones').click();
  await page.waitForTimeout(800);
  ok('analista/transacciones: ofrece «Importar CSV» y «Nueva transacción»', (await boton(page, 'Importar CSV').count()) === 1 && (await boton(page, 'Nueva transacción').count()) === 1);
  await ctx.close();
}
{
  const { ctx, page } = await sesion(navegador, 'gerente');
  await rail(page, 'Tiendas').click();
  await page.waitForTimeout(800);
  ok('gerente/tiendas: sin «Nueva tienda»', (await boton(page, 'Nueva tienda').count()) === 0);
  ok('gerente/tiendas: sin editar ni eliminar', (await editarOEliminar(page).count()) === 0);
  ok('gerente/tiendas: explica que es de solo lectura', /solo lectura/i.test(await texto(page)));
  ok('gerente: ningún 403 al recorrer tiendas', !page.http.some((h) => h.startsWith('403')), page.http.join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await sesion(navegador, 'analista');
  await rail(page, 'Zonas').click();
  await page.waitForTimeout(800);
  ok('analista/zonas: existe el módulo, sin «Nueva zona»', (await boton(page, 'Nueva zona').count()) === 0);
  ok('analista/zonas: sin editar ni eliminar', (await editarOEliminar(page).count()) === 0);
  ok('analista/zonas: explica que es de solo lectura', /solo lectura/i.test(await texto(page)));
  await boton(page, 'Comparar zonas').click();
  await page.waitForTimeout(600);
  ok('analista/zonas: la comparación abre', /comparar|Comparación/i.test(await texto(page)));
  ok('analista: ningún 403 al recorrer zonas', !page.http.some((h) => h.startsWith('403')), page.http.join(' | '));
  await ctx.close();
}

await navegador.close();
process.exit(resumen('03 permisos de escritura') ? 1 : 0);
