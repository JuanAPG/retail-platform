/// <reference types="vitest" />
import { Plugin, defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { validarUrlsDeEntrega } from './src/config/validarUrls';

/**
 * Modos de Vite = ambientes:
 *  - development (npm run dev): `.env.development`, HTTP local.
 *  - staging (npm run build:staging) y production (npm run build): `.env.staging` /
 *    `.env.production`, HTTPS. Si alguna URL de servicio no es https://, apunta a un host local o
 *    trae puerto, el build SE DETIENE: así el instalador de entrega nunca lleva localhost.
 */

/** Segunda red: revisa el JS ya generado; si quedó un host local o un puerto 31xx, falla el build. */
function sinHostsLocales(): Plugin {
  return {
    name: 'sin-hosts-locales',
    generateBundle(_opciones, bundle) {
      for (const archivo of Object.values(bundle)) {
        if (archivo.type !== 'chunk') continue;
        // Host local CON puerto (una URL de servicio). Un `http://localhost` suelto lo usan bibliotecas
        // (axios, react-router) como base fija para armar URLs relativas; no es una URL de servicio.
        const hallazgo = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2):\d+|:31\d\d\//.exec(archivo.code);
        if (hallazgo) {
          const contexto = archivo.code.slice(Math.max(0, hallazgo.index - 60), hallazgo.index + 60);
          this.error(`El build de entrega incluye "${hallazgo[0]}" en ${archivo.fileName}: …${contexto}…`);
        }
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const entrega = command === 'build' && mode !== 'development';
  if (entrega) {
    const entorno = loadEnv(mode, process.cwd(), 'VITE_');
    const problemas = validarUrlsDeEntrega(entorno);
    if (problemas.length > 0) {
      throw new Error(`Build "${mode}" detenido; URLs no válidas para entrega:\n - ${problemas.join('\n - ')}`);
    }
  }

  return {
    plugins: [react(), ...(entrega ? [sinHostsLocales()] : [])],
    base: './',
    build: { outDir: 'dist' },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    test: {
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  };
});
