// Utilidades comunes de las pruebas e2e del web (navegador real, servicios reales).
// Requisitos: los servicios del compose arriba (infra/docker-compose.yml) y `npm run dev` / el servicio `web` en 5173.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
export const PASSWORD = process.env.E2E_PASSWORD ?? 'Passw0rd123!'; // usuarios semilla de db/data_retail.sql (solo local)

// Usuarios semilla (db/data_retail.sql)
export const USUARIOS = {
  admin: 'admin@retail.mx',
  analista: 'analista@retail.mx',
  gerente: 'gercategoria@retail.mx',
  precios: 'precios@retail.mx',
  planeador: 'planeador@retail.mx',
  auditor: 'auditor@retail.mx',
  proveedor: 'contacto@bioorganicos.mx',
};

function rutaChrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidatos.find((c) => fs.existsSync(c));
}

export async function abrirNavegador() {
  const executablePath = rutaChrome();
  if (!executablePath) throw new Error('No se encontró Chrome/Edge. Define CHROME_PATH con la ruta al ejecutable.');
  return chromium.launch({ executablePath, headless: process.env.E2E_HEADED !== '1' });
}

const resultados = [];
export function ok(nombre, condicion, detalle = '') {
  resultados.push(!!condicion);
  console.log(condicion ? 'OK   ' : 'FALLA', nombre, detalle ? `— ${detalle}` : '');
}
export function resumen(titulo) {
  const fallas = resultados.filter((r) => !r).length;
  console.log(`\n${titulo}: ${resultados.length - fallas}/${resultados.length} OK`);
  return fallas;
}

export async function sesion(navegador, rol, viewport = { width: 1400, height: 900 }) {
  const ctx = await navegador.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errores = [];
  page.http = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400 && /localhost:3\d{3}/.test(r.url())) page.http.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', USUARIOS[rol]);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  return { ctx, page };
}

export const rail = (page, nombre) => page.locator(`button[aria-label="${nombre}"]`).first();
export const texto = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
export const espera = (page, re, ms = 6000) =>
  page
    .waitForFunction((s) => new RegExp(s).test(document.body.innerText.replace(/\s+/g, ' ')), re.source, { timeout: ms })
    .then(() => true)
    .catch(() => false);
export const json = (body, status = 200) => (ruta) =>
  ruta.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
