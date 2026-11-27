import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VARIABLES_URL, validarUrlsDeEntrega } from '../src/config/validarUrls';
import { urlServicio } from '../src/config/servicios';

/** URLs por ambiente: desarrollo puede ser HTTP local; staging y producción, solo HTTPS sin puertos. */

function leerEnv(archivo: string): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const linea of readFileSync(join(__dirname, '..', archivo), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*([^#\s]*)/.exec(linea);
    if (m) salida[m[1]] = m[2];
  }
  return salida;
}

describe('archivos de entorno', () => {
  it.each(['.env.production', '.env.staging'])('%s: todas las URLs son HTTPS, sin host local ni puerto', (archivo) => {
    const entorno = leerEnv(archivo);
    expect(Object.keys(entorno).sort()).toEqual([...VARIABLES_URL].sort());
    expect(validarUrlsDeEntrega(entorno)).toEqual([]);
    expect(Object.values(entorno).join(' ')).not.toMatch(/localhost|127\.0\.0\.1|:\d{2,5}\//);
  });

  it('.env.development define las 9 URLs locales (y NO pasaría como entrega)', () => {
    const entorno = leerEnv('.env.development');
    expect(Object.keys(entorno).sort()).toEqual([...VARIABLES_URL].sort());
    expect(validarUrlsDeEntrega(entorno).length).toBeGreaterThan(0);
  });

  it('.env.example documenta las mismas 9 variables', () => {
    expect(Object.keys(leerEnv('.env.example')).sort()).toEqual([...VARIABLES_URL].sort());
  });
});

describe('validarUrlsDeEntrega (lo que detiene el build de entrega)', () => {
  const base = Object.fromEntries(VARIABLES_URL.map((v) => [v, 'https://servicio.ejemplo.com/']));

  it('acepta HTTPS sin puerto', () => {
    expect(validarUrlsDeEntrega(base)).toEqual([]);
  });

  it.each([
    ['http://servicio.ejemplo.com/', /https/],
    ['https://localhost/', /host local/],
    ['https://127.0.0.1/', /host local/],
    ['https://servicio.ejemplo.com:8443/', /puerto/],
    ['no-es-url', /no es una URL/],
  ])('rechaza %s', (url, motivo) => {
    expect(validarUrlsDeEntrega({ ...base, VITE_INGESTION_URL: url }).join(' ')).toMatch(motivo);
  });

  it('rechaza una variable faltante', () => {
    const { VITE_DECISION_URL: _omitida, ...resto } = base;
    expect(validarUrlsDeEntrega(resto).join(' ')).toMatch(/VITE_DECISION_URL no está definida/);
  });
});

describe('urlServicio', () => {
  it('agrega la diagonal final y avisa si falta la variable', () => {
    expect(urlServicio('auth', { VITE_AUTH_URL: 'https://a.ejemplo.com' })).toBe('https://a.ejemplo.com/');
    expect(() => urlServicio('decision', {})).toThrow(/VITE_DECISION_URL/);
  });
});
