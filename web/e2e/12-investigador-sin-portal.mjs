// D-28: el Investigador de mercado es usuario de la app móvil y NO tiene portal web.
// Al iniciar sesión debe ver "acceso no permitido", no un error ni un bucle de login.
//
// No se agrega a USUARIOS de lib.mjs a propósito: 01-sesion-y-portales.mjs recorre
// ese mapa exigiendo portal y módulos, y este rol no tiene ninguno de los dos.
import { abrirNavegador, ok, resumen, texto, BASE, PASSWORD } from './lib.mjs';

const EMAIL = 'investigador@retail.mx'; // db/data_retail.sql

const navegador = await abrirNavegador();
const ctx = await navegador.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));

await page.goto(`${BASE}/login`);
await page.fill('input[type=email]', EMAIL);
await page.fill('input[type=password]', PASSWORD);
await page.click('button[type=submit]');

// Si el rol no se sembró, el login falla y nos quedamos en /login: eso es otro fallo
// (el del seed) y conviene distinguirlo de "entró pero no tiene portal".
const salio = await page
  .waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
ok('el usuario del seed inicia sesión', salio, salio ? '' : 'sigue en /login: ¿se recargó el seed?');

if (salio) {
  await page.waitForLoadState('networkidle').catch(() => {});
  const ruta = new URL(page.url()).pathname;
  ok('cae en la pantalla de acceso no permitido', ruta === '/no-autorizado', ruta);

  const t = await texto(page);
  ok('ve el mensaje, no un error', t.includes('No tienes acceso a esta pantalla'));
  ok('no es la pantalla de error genérica', !t.includes('Algo salió mal'));
  ok('sin errores de JS', errores.length === 0, errores[0] ?? '');

  // El bucle que tenía antes: /login -> portal '/login' -> /login...
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(1200);
  ok(
    'volver a /login con sesión abierta no deja un bucle',
    new URL(page.url()).pathname === '/no-autorizado',
    new URL(page.url()).pathname,
  );
}

await ctx.close();
await navegador.close();
process.exit(resumen('12 investigador sin portal') ? 1 : 0);
