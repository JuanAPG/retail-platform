// Parcial 3: el Gerente genera el reporte, prepara el archivo privado (GCS o el doble local de
// documents-service), lo descarga con la URL firmada y el hash coincide con el registro. Si el
// almacén falla, la web muestra un error recuperable y "Reintentar" lo deja disponible.
// Requisitos: auth, catalog, documents, mongodb y redis arriba, y el web en 5173.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { abrirNavegador, ok, resumen, sesion, rail, espera, json } from './lib.mjs';

const navegador = await abrirNavegador();
const tarjeta = (page, formato) => page.locator(`[data-formato="${formato}"]`);

{
  const { ctx, page } = await sesion(navegador, 'gerente');
  await rail(page, 'Reportes').click();
  await page.waitForTimeout(600);
  await page.fill('input[type=date] >> nth=0', '2026-08-01');
  await page.getByRole('button', { name: 'Generar reporte' }).click();
  ok('archivos: el reporte se genera y aparecen los archivos', await espera(page, /Archivos para descargar/, 20000));

  // PDF: preparar → disponible (con aviso) → descargar por URL firmada.
  await tarjeta(page, 'pdf').getByRole('button', { name: 'Preparar PDF' }).click();
  ok('archivos: el PDF pasa a disponible', await espera(page, /Tu archivo PDF ya se puede descargar/, 15000));
  ok('archivos: la tarjeta dice Disponible', (await tarjeta(page, 'pdf').innerText()).includes('Disponible'));

  const respuestaUrl = page.waitForResponse((r) => r.url().includes('/download-url') && r.request().method() === 'POST');
  const descarga = page.waitForEvent('download', { timeout: 15000 });
  await tarjeta(page, 'pdf').getByRole('button', { name: 'Descargar PDF' }).click();
  const firmada = await (await respuestaUrl).json();
  const archivo = await descarga;
  const bytes = await readFile(await archivo.path());
  ok('archivos: descarga con el nombre del reporte', /^reporte-ejecutivo-\d{4}-\d{2}-\d{2}\.pdf$/.test(archivo.suggestedFilename()), archivo.suggestedFilename());
  ok('archivos: el hash de lo descargado coincide con el registro', createHash('sha256').update(bytes).digest('hex') === firmada.sha256);
  ok('archivos: la URL vence en minutos', firmada.ttlSegundos > 0 && firmada.ttlSegundos <= 900, String(firmada.ttlSegundos));

  // Excel con el almacén caído (503 simulado): error recuperable; al quitar la falla, Reintentar funciona.
  const caido = (ruta) =>
    ruta.request().method() === 'POST'
      ? json({ statusCode: 503, code: 'SERVICE_UNAVAILABLE', message: 'El almacén de archivos no está disponible.', details: null, path: '/v1/reports/x/files', timestamp: new Date().toISOString() }, 503)(ruta)
      : ruta.continue();
  await page.route('**/v1/reports/*/files', caido);
  await tarjeta(page, 'xlsx').getByRole('button', { name: 'Preparar Excel' }).click();
  ok('archivos: almacén caído muestra Error', await espera(page, /almacén de archivos no está disponible|servicio no está disponible|no responde/i, 8000));
  ok('archivos: ofrece Reintentar', (await tarjeta(page, 'xlsx').getByRole('button', { name: 'Reintentar' }).count()) === 1);
  await page.unroute('**/v1/reports/*/files', caido);
  await tarjeta(page, 'xlsx').getByRole('button', { name: 'Reintentar' }).click();
  ok('archivos: el reintento deja el Excel disponible', await espera(page, /Tu archivo Excel ya se puede descargar/, 15000));

  ok('archivos: sin errores JS', page.errores.length === 0, page.errores[0] ?? '');
  await ctx.close();
}

await navegador.close();
process.exit(resumen('13 reportes: archivo privado y descarga firmada') ? 1 : 0);
