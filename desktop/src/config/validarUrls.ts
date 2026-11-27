/**
 * Regla de las URLs del build de entrega (staging y producción). La usa vite.config.ts al
 * compilar y las pruebas. Sin dependencias del navegador: corre en Node.
 */

/** Variables que la app necesita (una por servicio, ver src/config/servicios.ts). */
export const VARIABLES_URL = [
  'VITE_AUTH_URL',
  'VITE_CATALOG_URL',
  'VITE_ALGORITHMS_URL',
  'VITE_DECISION_URL',
  'VITE_DOCUMENTS_URL',
  'VITE_INGESTION_URL',
  'VITE_SEGMENTATION_URL',
] as const;

const HOSTS_LOCALES = ['localhost', '127.0.0.1', '0.0.0.0', '10.0.2.2', '::1', '[::1]'];

/** Devuelve la lista de problemas (vacía = todo bien). */
export function validarUrlsDeEntrega(entorno: Record<string, string | undefined>): string[] {
  const problemas: string[] = [];
  for (const variable of VARIABLES_URL) {
    const valor = entorno[variable];
    if (!valor) {
      problemas.push(`${variable} no está definida`);
      continue;
    }
    let url: URL;
    try {
      url = new URL(valor);
    } catch {
      problemas.push(`${variable} = ${valor} no es una URL`);
      continue;
    }
    if (url.protocol !== 'https:') problemas.push(`${variable} = ${valor} debe usar https://`);
    if (HOSTS_LOCALES.includes(url.hostname.toLowerCase())) problemas.push(`${variable} = ${valor} apunta a un host local`);
    if (url.port !== '') problemas.push(`${variable} = ${valor} no debe llevar puerto (el balanceador expone 443)`);
  }
  return problemas;
}
