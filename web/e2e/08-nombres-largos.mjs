// Nombres largos sin espacios (como los que dejan algunas pruebas de integración) no deben desbordar tarjetas ni la página.
import { abrirNavegador, ok, resumen, sesion, rail, json } from './lib.mjs';

const navegador = await abrirNavegador();
const LARGO = 'T17915732221870.07516078143767524ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Elementos cuyo contenido se sale de su caja (excluye los que hacen scroll a propósito). */
async function desbordes(page) {
  return page.evaluate(() => {
    const malos = [];
    for (const el of document.querySelectorAll('article, [class*="rounded-card"], [class*="rounded-panel"], td, li')) {
      const estilo = getComputedStyle(el);
      if (/(auto|scroll)/.test(estilo.overflowX) || estilo.display === 'none') continue;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) malos.push(`${el.tagName}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    return { malos: malos.slice(0, 5), pagina: document.documentElement.scrollWidth > window.innerWidth + 2 };
  });
}

const tienda = (i) => ({ id: `t${i}`, nombre: LARGO + i, activo: true, formato: 'minimarket', zonaId: 'z', zona: { id: 'z', nombre: 'Zona RB 73212665' }, direccion: { calle: LARGO, codigoPostal: '64000' } });
const zona = (i) => ({ id: `z${i}`, nombre: LARGO + i, activo: true, municipioId: 1, municipio: { id: 1, nombre: 'Monterrey' }, descripcion: LARGO });
const producto = (i) => ({ id: `p${i}`, sku: LARGO, nombre: LARGO + i, descripcion: LARGO, categoria: { id: 1, nombre: 'Abarrotes' }, presentaciones: [], estatus: 'activo', esCanastaBasica: false, proveedor: null });
const pagina = (arr) => json({ data: arr, total: arr.length, page: 1, limit: 100 });

for (const [rol, anchos] of [['auditor', [1400, 390]], ['analista', [1400, 390]], ['planeador', [1400]], ['admin', [1400, 390]], ['gerente', [1400, 390]], ['proveedor', [1400, 390]]]) {
  for (const ancho of anchos) {
    const { ctx, page } = await sesion(navegador, rol, { width: ancho, height: 900 });
    await page.route('**/localhost:3102/v1/stores?**', pagina([1, 2, 3].map(tienda)));
    await page.route('**/localhost:3102/v1/zones?**', pagina([1, 2, 3].map(zona)));
    await page.route('**/localhost:3102/v1/products?**', pagina([1, 2, 3].map(producto)));
    await page.reload();
    await page.waitForLoadState('networkidle');
    const modulos = ['Tiendas', 'Zonas', 'Productos', 'Catálogo de productos', 'Mis productos', 'Mis solicitudes'];
    for (const m of modulos) {
      if (!(await page.locator(`button[aria-label="${m}"]`).count())) continue;
      await rail(page, m).click();
      await page.waitForTimeout(700);
      const d = await desbordes(page);
      ok(`${rol} ${ancho}px › ${m}: nada se sale de su tarjeta`, d.malos.length === 0 && !d.pagina, d.malos.join(' | ') + (d.pagina ? ' [scroll horizontal]' : ''));
    }
    await ctx.close();
  }
}

await navegador.close();
process.exit(resumen('08 nombres largos') ? 1 : 0);
