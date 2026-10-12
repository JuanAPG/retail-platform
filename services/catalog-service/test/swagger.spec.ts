/**
 * Gate del PR: Swagger con ejemplo de respuesta en JSON **y** en XML en cada
 * ruta de negocio. Lee la documentación real que publica el servicio
 * (`/docs-json`), así que falla si alguien agrega una ruta sin documentarla.
 *
 *   docker compose up -d postgres redis catalog-service
 *   npm run test:integracion
 */
const BASE = process.env.CATALOG_BASE_URL ?? 'http://localhost:3102';

type Operacion = { responses?: Record<string, { content?: Record<string, { example?: unknown }> }>; summary?: string };

async function documentacion(): Promise<{ paths: Record<string, Record<string, Operacion>> }> {
  const respuesta = await fetch(`${BASE}/docs-json`);
  expect(respuesta.status).toBe(200);
  return respuesta.json();
}

describe('Swagger (integración, requiere stack)', () => {
  it('cada ruta de negocio documenta su respuesta exitosa en JSON y en XML', async () => {
    const { paths } = await documentacion();
    const rutas = Object.entries(paths).filter(([ruta]) => !ruta.endsWith('/health'));
    // 5 segmentos + 9 zonas/municipios (con indicadores y clasificación) + 6 tiendas + 16 productos/catálogos.
    const operaciones = rutas.reduce((total, [, metodos]) => total + Object.keys(metodos).length, 0);
    expect(operaciones).toBe(36);

    const fallas: string[] = [];
    for (const [ruta, metodos] of rutas) {
      for (const [metodo, operacion] of Object.entries(metodos)) {
        const etiqueta = `${metodo.toUpperCase()} ${ruta}`;
        if (!operacion.summary) fallas.push(`${etiqueta}: sin resumen`);

        const exitosas = Object.entries(operacion.responses ?? {}).filter(([estado]) => estado.startsWith('2'));
        if (exitosas.length === 0) fallas.push(`${etiqueta}: sin respuesta 2xx documentada`);

        for (const [estado, respuesta] of exitosas) {
          if (estado === '204') continue; // sin cuerpo
          const contenido = respuesta.content ?? {};
          if (contenido['application/json']?.example === undefined) fallas.push(`${etiqueta} ${estado}: sin ejemplo JSON`);
          const xml = contenido['application/xml']?.example;
          // CAT-15: el ejemplo trae la raíz con nombre y el namespace reales, nunca un <response> genérico.
          if (typeof xml !== 'string' || xml.includes('<response>') || !xml.includes('xmlns="catalog/v1"')) {
            fallas.push(`${etiqueta} ${estado}: el ejemplo XML no es el que emite el servicio (raíz con namespace catalog/v1)`);
          }
        }
      }
    }
    expect(fallas).toEqual([]);
  });

  it('las rutas documentan sus errores estándar con el cuerpo {statusCode, message, code, details, path, timestamp}', async () => {
    const { paths } = await documentacion();
    const lista = paths['/v1/segments'].get.responses ?? {};

    const ejemplo = lista['401']?.content?.['application/json']?.example as Record<string, unknown>;
    expect(Object.keys(ejemplo).sort()).toEqual(['code', 'details', 'message', 'path', 'statusCode', 'timestamp']);
  });

  it('el ejemplo XML de una lista coincide con la forma que el servicio emite de verdad', async () => {
    const { paths } = await documentacion();
    const ejemplo = paths['/v1/segments'].get.responses?.['200']?.content?.['application/xml']?.example as string;

    // Misma estructura que `GET /v1/segments` con Accept: application/xml.
    expect(ejemplo).toContain('<segmentListResponse xmlns="catalog/v1">');
    for (const etiqueta of ['<data>', '<item>', '<total>', '<page>', '<limit>']) {
      expect(ejemplo).toContain(etiqueta);
    }
    expect(ejemplo.match(/<data>/g)).toHaveLength(1);
  });

  it('CAT-15: los errores documentan también su ejemplo en XML (<error>)', async () => {
    const { paths } = await documentacion();
    const xml = paths['/v1/segments'].get.responses?.['401']?.content?.['application/xml']?.example as string;
    expect(xml).toContain('<error xmlns="catalog/v1">');
    expect(xml).toContain('<statusCode>401</statusCode>');
  });
});
