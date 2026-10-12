// Fallos inyectados con page.route (repetibles, sin tocar Docker): 500, 403, 404, sin red, token vencido, datos basura.
// Opcional con E2E_DOCKER=1: servicio caído (docker stop) y Redis colgado (docker pause).
import { execSync } from 'node:child_process';
import { abrirNavegador, ok, resumen, sesion, rail, texto, espera, json, BASE } from './lib.mjs';

const navegador = await abrirNavegador();

// --- Portal Admin: los datos se piden al montar, por eso se recarga tras interceptar ---
{
  const { ctx, page } = await sesion(navegador, 'admin');

  await page.route('**/localhost:3102/v1/zones**', json({ statusCode: 500, message: 'boom', code: 'INTERNAL' }, 500));
  await page.reload();
  await rail(page, 'Zonas').click();
  ok('500: el panel dice que hubo error interno', await espera(page, /error interno/));
  ok('500: aviso global con el servicio', await espera(page, /catalog-service tuvo un error interno/, 3000));
  ok('500: hay botón Reintentar', (await page.getByRole('button', { name: 'Reintentar' }).count()) > 0);
  await page.unroute('**/localhost:3102/v1/zones**');

  await page.route('**/localhost:3101/v1/usuarios**', json({ statusCode: 403, message: 'Forbidden resource', code: 'FORBIDDEN' }, 403));
  await page.reload();
  await rail(page, 'Usuarios').click();
  ok('403: avisa de falta de permiso', await espera(page, /permiso/i));
  await page.unroute('**/localhost:3101/v1/usuarios**');

  await page.route('**/localhost:3102/v1/providers**', json({ statusCode: 404, message: 'No existe', code: 'NOT_FOUND' }, 404));
  await page.reload();
  await rail(page, 'Proveedores').click();
  ok('404: mensaje legible', await espera(page, /No existe|No se encontr/));
  await page.unroute('**/localhost:3102/v1/providers**');

  for (const [nombre, cuerpo, tipo] of [['null', 'null', 'application/json'], ['objeto sin data', '{"foo":1}', 'application/json'], ['HTML', '<html>proxy</html>', 'text/html']]) {
    await page.route('**/localhost:3102/v1/stores**', (r) => r.fulfill({ status: 200, contentType: tipo, body: cuerpo }));
    await page.reload();
    await rail(page, 'Tiendas').click();
    await page.waitForTimeout(1200);
    ok(`respuesta ${nombre}: la app no se cae`, !(await texto(page)).includes('Algo salió mal') && page.errores.length === 0, page.errores[0] ?? '');
    await page.unroute('**/localhost:3102/v1/stores**');
  }

  await page.reload();
  await page.waitForLoadState('networkidle');
  await ctx.setOffline(true);
  await rail(page, 'Zonas').click();
  ok('sin red: mensaje de conexión', await espera(page, /No se pudo conectar/));
  await ctx.setOffline(false);
  await ctx.close();
}

// --- Sesión: token vencido se renueva; sin refresh válido manda a login con aviso ---
{
  const { ctx, page } = await sesion(navegador, 'admin');
  await page.evaluate(() => localStorage.setItem('accessToken', 'basura.invalida.token'));
  await page.reload();
  await page.waitForTimeout(2500);
  const nuevo = await page.evaluate(() => localStorage.getItem('accessToken'));
  ok('token vencido: se renueva y la sesión sigue', page.url().includes('/admin') && nuevo !== 'basura.invalida.token', page.url());
  await page.evaluate(() => { localStorage.setItem('accessToken', 'x'); localStorage.setItem('refreshToken', 'x'); });
  await rail(page, 'Zonas').click();
  await page.waitForURL(/login/, { timeout: 8000 }).catch(() => {});
  ok('sin refresh válido: va a login', page.url().includes('/login'));
  ok('login avisa que la sesión expiró', await espera(page, /sesión expiró/));
  await ctx.close();
}

// --- Paneles nuevos con datos hostiles ---
{
  const { ctx, page } = await sesion(navegador, 'gerente');
  await page.route('**/localhost:3108/v1/reports?**', json({ data: [{ id: 'x', estado: 'raro', creadoEn: 'no-es-fecha' }, { id: 'y' }, null], total: 'abc' }));
  await page.route('**/localhost:3109/v1/notifications?**', json({ data: [{ id: 'n1', title: 'T', createdAt: 'mal' }, null], total: 2 }));
  await page.route('**/localhost:3109/v1/notifications/unread-count', json({ unread: 'muchas' }));
  await page.reload();
  await page.waitForLoadState('networkidle');
  await rail(page, 'Reportes').click();
  await page.waitForTimeout(1200);
  ok('reportes con basura: no se cae', !(await texto(page)).includes('Algo salió mal') && page.errores.length === 0, page.errores[0] ?? '');
  await page.locator('button[aria-label^="Notificaciones"]').click();
  await page.waitForTimeout(800);
  ok('notificaciones con basura: no se cae', !(await texto(page)).includes('Algo salió mal') && page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}

// --- Opcionales con Docker ---
if (process.env.E2E_DOCKER === '1') {
  const sh = (c) => { try { execSync(c, { stdio: 'pipe' }); } catch { /* ya estaba así */ } };
  {
    const { ctx, page } = await sesion(navegador, 'gerente');
    sh('docker stop retail_documents_service');
    await rail(page, 'Reportes').click();
    ok('servicio caído: el panel lo dice', await espera(page, /No se pudo conectar/));
    sh('docker start retail_documents_service');
    await ctx.close();
  }
  {
    const { ctx, page } = await sesion(navegador, 'admin');
    sh('docker pause retail_redis');
    const t0 = Date.now();
    await rail(page, 'Tiendas').click();
    const v = await espera(page, /no está disponible|error interno|tardó/i, 12000);
    sh('docker unpause retail_redis');
    ok('Redis colgado: error en menos de 8 s (503, no se cuelga)', v && Date.now() - t0 < 8000, `${Date.now() - t0}ms`);
    await ctx.close();
  }
}

await navegador.close();
process.exit(resumen('02 errores') ? 1 : 0);
