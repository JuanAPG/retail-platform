/**
 * URL base de cada microservicio, por ambiente. Salen de los archivos de Vite:
 *  - `.env.development` (npm run dev / electron:dev): HTTP local del docker-compose.
 *  - `.env.staging` (npm run build:staging) y `.env.production` (npm run build): HTTPS.
 * `vite.config.ts` detiene el build de staging o producción si alguna URL no es HTTPS o
 * apunta a localhost o a un puerto. Aquí no hay URLs escritas ni puertos derivados.
 */

export type Servicio =
  | 'auth'
  | 'catalog'
  | 'algorithms'
  | 'decision'
  | 'documents'
  | 'ingestion'
  | 'segmentation'
  | 'promotion'
  | 'workflow';

/** Nombre del microservicio, para mostrarlo en pantalla y en los errores. */
export const NOMBRE_SERVICIO: Record<Servicio, string> = {
  auth: 'auth-service',
  catalog: 'catalog-service',
  algorithms: 'algorithms-core',
  decision: 'decision-service',
  documents: 'documents-service',
  ingestion: 'transactions-ingestion-service',
  segmentation: 'income-segmentation-service',
  promotion: 'promotion-service',
  workflow: 'recommendations-workflow-service',
};

/** Variable de entorno de cada servicio (ver `.env.example`). */
export const VARIABLE_SERVICIO: Record<Servicio, string> = {
  auth: 'VITE_AUTH_URL',
  catalog: 'VITE_CATALOG_URL',
  algorithms: 'VITE_ALGORITHMS_URL',
  decision: 'VITE_DECISION_URL',
  documents: 'VITE_DOCUMENTS_URL',
  ingestion: 'VITE_INGESTION_URL',
  segmentation: 'VITE_SEGMENTATION_URL',
  promotion: 'VITE_PROMOTION_URL',
  workflow: 'VITE_WORKFLOW_URL',
};

/**
 * Las 9 variables, nombradas una por una: así Vite solo incrusta estas en el build. Pasar el
 * objeto `import.meta.env` completo incrustaría TODAS las VITE_* del ambiente (incluidas las de un
 * `.env` local viejo con localhost) en el instalador de entrega.
 */
function entornoDeVite(): Record<string, string | undefined> {
  return {
    VITE_AUTH_URL: import.meta.env.VITE_AUTH_URL,
    VITE_CATALOG_URL: import.meta.env.VITE_CATALOG_URL,
    VITE_ALGORITHMS_URL: import.meta.env.VITE_ALGORITHMS_URL,
    VITE_DECISION_URL: import.meta.env.VITE_DECISION_URL,
    VITE_DOCUMENTS_URL: import.meta.env.VITE_DOCUMENTS_URL,
    VITE_INGESTION_URL: import.meta.env.VITE_INGESTION_URL,
    VITE_SEGMENTATION_URL: import.meta.env.VITE_SEGMENTATION_URL,
    VITE_PROMOTION_URL: import.meta.env.VITE_PROMOTION_URL,
    VITE_WORKFLOW_URL: import.meta.env.VITE_WORKFLOW_URL,
  };
}

/** URL base (termina en `/`). Falla con un mensaje claro si la variable no está definida. */
export function urlServicio(servicio: Servicio, entorno: Record<string, string | undefined> = entornoDeVite()): string {
  const variable = VARIABLE_SERVICIO[servicio];
  const valor = entorno[variable];
  if (!valor) {
    throw new Error(`Falta ${variable} (URL de ${NOMBRE_SERVICIO[servicio]}). Revisa los archivos .env del escritorio.`);
  }
  return valor.endsWith('/') ? valor : `${valor}/`;
}
