// El círculo resaltado del menú lateral (hover o foco) nunca queda cortado por el scroll de la lista.
import { abrirNavegador, ok, resumen, sesion } from './lib.mjs';

const navegador = await abrirNavegador();

for (const alto of [600, 700, 900]) {
  const { ctx, page } = await sesion(navegador, 'analista', { width: 1400, height: alto });
  const botones = page.locator('nav[aria-label="Módulos"] .scrollbar-hidden button[aria-label]');
  const n = await botones.count();
  let cortados = 0;
  for (let i = 0; i < n; i++) {
    await botones.nth(i).hover();
    await page.waitForTimeout(60);
    const r = await page.evaluate((idx) => {
      const dock = document.querySelector('nav[aria-label="Módulos"] .scrollbar-hidden');
      const b = dock.querySelectorAll('button[aria-label]')[idx];
      const d = dock.getBoundingClientRect();
      const x = b.getBoundingClientRect();
      return x.top >= d.top - 1 && x.bottom <= d.bottom + 1;
    }, i);
    if (!r) cortados++;
  }
  ok(`analista a ${alto}px: al pasar el mouse por cada uno de los ${n} íconos el círculo se ve completo`, cortados === 0, `${cortados} cortados`);

  // con teclado también (Tab → foco)
  await page.keyboard.press('Tab');
  await ctx.close();
}

await navegador.close();
process.exit(resumen('09 menú lateral') ? 1 : 0);
