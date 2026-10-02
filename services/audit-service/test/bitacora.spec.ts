/**
 * Integración POST → GET (corre en la VM con Docker).
 *
 * Requiere: `docker compose up -d postgres redis audit-service` y un token
 * de Administrador emitido por auth-service (ver su README). No corre en
 * CI sin infraestructura; se ejecuta a mano:
 *
 *   npm run test:integracion
 */
const BASE = process.env.AUDIT_BASE_URL ?? 'http://localhost:3110';
const TOKEN = process.env.AUDIT_TOKEN ?? '';

async function postEvento(cuerpo: object) {
  const respuesta = await fetch(`${BASE}/v1/auditoria`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function getBitacora(params: string) {
  const respuesta = await fetch(`${BASE}/v1/auditoria${params}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

describe('bitácora de punta a punta (integración, requiere stack)', () => {
  it('lo reportado por POST aparece en el GET con filtros', async () => {
    const marca = `integracion-${Date.now()}`;
    const creado = await postEvento({
      tabla: 'prueba',
      registroId: marca,
      accion: 'insert',
      descripcion: 'Evento de prueba.',
      cambios: [{ campo: 'estado', previo: null, posterior: 'nuevo' }],
    });
    expect(creado.estado).toBe(201);
    expect(creado.cuerpo.id).toBeDefined();

    const bitacora = await getBitacora(`?tabla=prueba&registroId=${marca}`);
    expect(bitacora.estado).toBe(200);
    expect(bitacora.cuerpo.total).toBeGreaterThanOrEqual(1);
    expect(bitacora.cuerpo.data[0]).toMatchObject({ tablaAfectada: 'prueba' });
  });

  it('sin token el GET es 401', async () => {
    const respuesta = await fetch(`${BASE}/v1/auditoria`);
    expect(respuesta.status).toBe(401);
  });
});
