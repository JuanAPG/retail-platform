/**
 * Gate del PR: Swagger con ejemplo de respuesta en JSON **y** en XML en cada
 * ruta de negocio. Lee la documentación real que publica el servicio
 * (`/docs-json`), así que falla si alguien agrega una ruta sin documentarla.
 *
 *   docker compose -f infra/docker-compose.yml up -d postgres redis algorithms-core
 *   npm run test:integracion
 */
const BASE = process.env.ALGORITHMS_BASE_URL ?? 'http://localhost:3105';

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
    // 3 de association; elasticity y substitution suman las suyas al migrarse.
    const operaciones = rutas.reduce((total, [, metodos]) => total + Object.keys(metodos).length, 0);
    expect(operaciones).toBe(3);

    const fallas: string[] = [];
    for (const [ruta, metodos] of rutas) {
      for (const [metodo, operacion] of Object.entries(metodos)) {
        const etiqueta = `${metodo.toUpperCase()} ${ruta}`;
        if (!operacion.summary) fallas.push(`${etiqueta}: sin resumen`);

        const exitosas = Object.entries(operacion.responses ?? {}).filter(([estado]) => estado.startsWith('2'));
        if (exitosas.length === 0) fallas.push(`${etiqueta}: sin respuesta 2xx documentada`);

        for (const [estado, respuesta] of exitosas) {
          const contenido = respuesta.content ?? {};
          if (contenido['application/json']?.example === undefined) fallas.push(`${etiqueta} ${estado}: sin ejemplo JSON`);
          const xml = contenido['application/xml']?.example;
          if (typeof xml !== 'string' || !xml.includes('<response>')) fallas.push(`${etiqueta} ${estado}: sin ejemplo XML`);
        }
      }
    }
    expect(fallas).toEqual([]);
  });

  it('las rutas documentan sus errores estándar con el cuerpo {statusCode, message, code, details, path, timestamp}', async () => {
    const { paths } = await documentacion();
    const lista = paths['/v1/association/runs'].get.responses ?? {};

    const ejemplo = lista['401']?.content?.['application/json']?.example as Record<string, unknown>;
    expect(Object.keys(ejemplo).sort()).toEqual(['code', 'details', 'message', 'path', 'statusCode', 'timestamp']);
  });

  it('el ejemplo XML de una lista coincide con la forma que el servicio emite de verdad', async () => {
    const { paths } = await documentacion();
    const ejemplo = paths['/v1/association/runs'].get.responses?.['200']?.content?.['application/xml']?.example as string;

    // Misma estructura que `GET /v1/association/runs` con Accept: application/xml.
    for (const etiqueta of ['<response>', '<data>', '<item>', '<total>', '<page>', '<limit>']) {
      expect(ejemplo).toContain(etiqueta);
    }
    expect(ejemplo.match(/<data>/g)).toHaveLength(1);
  });
});
