// Si un listado tiene más filas que el tope de 2 000, la pantalla lo avisa con el total real (no trunca en silencio).
import { abrirNavegador, ok, resumen, sesion, rail, espera, json } from './lib.mjs';

const navegador = await abrirNavegador();

{
  const { ctx, page } = await sesion(navegador, 'admin');
  const filas = (n, offset) => Array.from({ length: n }, (_, i) => ({ id: `t-${offset + i}`, nombre: `Tienda ${offset + i}`, activo: true, formato: 'otro', direccion: {}, zona: { nombre: 'Z' } }));
  let pedidas = 0;
  await page.route('**/localhost:3102/v1/stores?**', (r) => {
    const pagina = Number(new URL(r.request().url()).searchParams.get('page') ?? 1);
    pedidas++;
    return json({ data: filas(100, (pagina - 1) * 100), total: 7431, page: pagina, limit: 100 })(r);
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await rail(page, 'Tiendas').click();
  ok('truncamiento: avisa «2,000 de 7,431 registros»', await espera(page, /2,000 de 7,431 registros|2\.000 de 7\.431 registros/, 8000));
  // 20 páginas de tope por carga; en desarrollo React StrictMode monta dos veces, por eso hasta 40.
  ok('truncamiento: respeta el tope de 20 páginas por carga', pedidas <= 42, `${pedidas} peticiones`);
  ok('truncamiento: sin errores JS', page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}
{
  // Con datos que caben, no hay aviso.
  const { ctx, page } = await sesion(navegador, 'admin');
  await rail(page, 'Tiendas').click();
  await page.waitForTimeout(1200);
  ok('sin truncamiento: no aparece el aviso', !(await page.locator('[role=alert]', { hasText: 'registros' }).count()));
  await ctx.close();
}

await navegador.close();
process.exit(resumen('07 truncamiento') ? 1 : 0);
