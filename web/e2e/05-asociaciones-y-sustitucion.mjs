// RF-13/14 (Apriori y FP-Growth, solo el Analista) y RF-17 (sustitución desde algorithms-core, sin respaldo del monolito).
import { abrirNavegador, ok, resumen, sesion, rail, texto, espera } from './lib.mjs';

const navegador = await abrirNavegador();

{
  const { ctx, page } = await sesion(navegador, 'analista');
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /association\/.*\/run/.test(r.url())) posts.push(r.url().replace('http://localhost:', '')); });

  await rail(page, 'Reglas de asociación').click();
  await page.waitForTimeout(600);
  ok('analista: ve el selector de algoritmo', (await page.locator('#apr-algoritmo, button:has-text("Apriori")').count()) > 0);
  await page.getByRole('button', { name: 'Analizar' }).click();
  await page.waitForTimeout(2500);
  ok('analista: Apriori llama a /association/apriori/run', posts.some((u) => u.includes('apriori/run')), posts.join(','));

  await page.locator('button', { hasText: /^Apriori$/ }).first().click();
  await page.locator('[role=option]', { hasText: 'FP-Growth' }).click();
  await page.getByRole('button', { name: 'Analizar' }).click();
  await page.waitForTimeout(2500);
  ok('analista: FP-Growth llama a /association/fpgrowth/run', posts.some((u) => u.includes('fpgrowth/run')), posts.join(','));
  ok('analista: asociaciones sin 403 ni errores JS', !page.http.some((h) => h.startsWith('403')) && page.errores.length === 0, page.http.join(' | '));

  const llamadas = [];
  page.on('response', (r) => { if (/substitution/.test(r.url())) llamadas.push(`${r.status()} ${r.url().replace('http://localhost:', '')}`); });
  await rail(page, 'Sustitución').click();
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: 'Elige una categoría' }).first().click();
  await page.locator('[role=option]').nth(0).click();
  await page.waitForTimeout(2000);
  ok('sustitución: la responde algorithms-core (3105), no el monolito', llamadas.length === 1 && llamadas[0].startsWith('200 3105/'), llamadas.join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await sesion(navegador, 'admin');
  await page.goto('http://localhost:5173/analista');
  await page.waitForLoadState('networkidle');
  await rail(page, 'Reglas de asociación').click();
  await page.waitForTimeout(600);
  ok('admin: no se le ofrece correr asociaciones (daría 403)', (await page.getByRole('button', { name: 'Analizar' }).count()) === 0 && /Solo el Analista comercial/.test(await texto(page)));
  await ctx.close();
}

await navegador.close();
process.exit(resumen('05 asociaciones y sustitución') ? 1 : 0);
