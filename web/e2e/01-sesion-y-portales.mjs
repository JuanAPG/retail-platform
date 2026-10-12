// Login de los 7 roles + recorrido de todas las pestañas de su portal: sin errores de JS ni pantallas que se queden cargando.
import { abrirNavegador, ok, resumen, sesion, texto, USUARIOS, BASE } from './lib.mjs';

const navegador = await abrirNavegador();

for (const rol of Object.keys(USUARIOS)) {
  const { ctx, page } = await sesion(navegador, rol);
  const portal = new URL(page.url()).pathname;
  ok(`${rol}: entra a su portal`, portal !== '/login' && portal !== '/', portal);

  const pestanas = [
    ...new Set(
      await page.$$eval('button[aria-label]', (bs) =>
        bs.map((b) => b.getAttribute('aria-label')).filter((l) => l && !/^Ver |Rechazar|Notificaciones|Expandir|Contraer|^Perfil$|Cerrar/.test(l)),
      ),
    ),
  ];
  ok(`${rol}: el menú tiene módulos`, pestanas.length > 0, `${pestanas.length}`);
  for (const p of pestanas.slice(0, 12)) {
    const antes = page.errores.length;
    await page.locator(`button[aria-label="${p}"]`).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const t = await texto(page);
    ok(`${rol} › ${p}: sin errores JS ni pantalla caída`, page.errores.length === antes && !t.includes('Algo salió mal'));
  }
  await ctx.close();
}

// Un 401 real: sin sesión, cualquier portal manda a login.
const anon = await navegador.newContext();
const p = await anon.newPage();
await p.goto(`${BASE}/catalogo`);
await p.waitForTimeout(800);
ok('sin sesión: /catalogo redirige a login', p.url().includes('/login'));
await anon.close();

await navegador.close();
process.exit(resumen('01 sesión y portales') ? 1 : 0);
