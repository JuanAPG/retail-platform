/**
 * Gate del PR: Swagger con ejemplo de respuesta en JSON **y** en XML en cada ruta de
 * negocio. Lee la documentación real que publica el servicio (`/docs-json`), así que falla
 * si alguien agrega una ruta sin documentarla. El ejemplo XML debe ser el que el servicio
 * emite de verdad (raíz con nombre y namespace), no un `<response>` genérico.
 *
 *   docker compose -f infra/docker-compose.yml up -d mongodb redis documents-service
 *   npm run test:integracion
 */
const BASE = process.env.DOCUMENTS_BASE_URL ?? 'http://localhost:3108';

type Operacion = { responses?: Record<string, { content?: Record<string, { example?: unknown }> }>; summary?: string };

async function documentacion(): Promise<{ paths: Record<string, Record<string, Operacion>> }> {
  const respuesta = await fetch(`${BASE}/docs-json`);
  expect(respuesta.status).toBe(200);
  return respuesta.json();
}

const RAICES: Record<string, string> = {
  'POST /v1/reports/executive': 'reportResponse',
  'GET /v1/reports': 'reportListResponse',
  'GET /v1/reports/stats/by-user-month': 'reportStatsResponse',
  'GET /v1/reports/{id}': 'reportResponse',
  'PATCH /v1/reports/{id}': 'reportResponse',
};

describe('Swagger (integración, requiere stack)', () => {
  it('cada ruta de negocio documenta su respuesta exitosa en JSON y en XML', async () => {
    const { paths } = await documentacion();
    const rutas = Object.entries(paths).filter(([ruta]) => !ruta.endsWith('/health'));
    // POST executive, GET lista, GET stats, GET :id, PATCH :id y GET :id/export.
    expect(rutas.reduce((total, [, metodos]) => total + Object.keys(metodos).length, 0)).toBe(6);

    const fallas: string[] = [];
    for (const [ruta, metodos] of rutas) {
      for (const [metodo, operacion] of Object.entries(metodos)) {
        const etiqueta = `${metodo.toUpperCase()} ${ruta}`;
        if (!operacion.summary) fallas.push(`${etiqueta}: sin resumen`);
        const exitosas = Object.entries(operacion.responses ?? {}).filter(([estado]) => estado.startsWith('2'));
        if (exitosas.length === 0) fallas.push(`${etiqueta}: sin respuesta 2xx documentada`);

        for (const [estado, respuesta] of exitosas) {
          const contenido = respuesta.content;
          if (!contenido) continue; // el PDF y los 204 no llevan ejemplo JSON/XML
          if (contenido['application/json']?.example === undefined) fallas.push(`${etiqueta} ${estado}: sin ejemplo JSON`);
          const xml = contenido['application/xml']?.example;
          const raiz = RAICES[etiqueta];
          if (typeof xml !== 'string' || !xml.includes(`<${raiz} xmlns="documents/v1">`)) {
            fallas.push(`${etiqueta} ${estado}: el ejemplo XML no trae la raíz ${raiz} con su namespace`);
          }
        }
      }
    }
    expect(fallas).toEqual([]);
  });

  it('las rutas documentan sus errores estándar con el cuerpo {statusCode, message, code, details, path, timestamp}', async () => {
    const { paths } = await documentacion();
    const ejemplo = paths['/v1/reports'].get.responses?.['401']?.content?.['application/json']?.example as Record<string, unknown>;
    expect(Object.keys(ejemplo).sort()).toEqual(['code', 'details', 'message', 'path', 'statusCode', 'timestamp']);
  });

  it('la exportación documenta el PDF', async () => {
    const { paths } = await documentacion();
    expect(paths['/v1/reports/{id}/export'].get.summary).toContain('PDF');
  });
});
