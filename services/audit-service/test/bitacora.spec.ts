/**
 * Integración POST → GET (corre en la VM con Docker).
 *
 * Requiere: `docker compose up -d postgres redis audit-service` y tokens
 * reales emitidos por auth-service (ver su README):
 *   - `AUDIT_TOKEN`: cualquier perfil interno con sesión activa (se usa
 *     para reportar Y para leer, salvo que el perfil no sea Administrador
 *     ni Auditor — en ese caso usa uno que sí lo sea para los GET).
 *   - `AUDIT_TOKEN_PROVEEDOR`: opcional, token de un Proveedor con sesión
 *     activa, para la prueba de "Proveedor puede reportar".
 * No corre en CI sin infraestructura; se ejecuta a mano:
 *
 *   npm run test:integracion
 */
const BASE = process.env.AUDIT_BASE_URL ?? 'http://localhost:3110';
const TOKEN = process.env.AUDIT_TOKEN ?? '';
const TOKEN_PROVEEDOR = process.env.AUDIT_TOKEN_PROVEEDOR;

async function postEvento(cuerpo: object, token?: string) {
  const respuesta = await fetch(`${BASE}/v1/auditoria`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function getBitacora(params: string, token = TOKEN) {
  const respuesta = await fetch(`${BASE}/v1/auditoria${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

describe('bitácora de punta a punta (integración, requiere stack)', () => {
  it('lo reportado por POST aparece en el GET con filtros, con el actor del token', async () => {
    const marca = `integracion-${Date.now()}`;
    const creado = await postEvento(
      {
        tabla: 'prueba',
        registroId: marca,
        servicio: 'audit-service-test',
        accion: 'insert',
        descripcion: 'Evento de prueba.',
        cambios: [{ campo: 'estado', previo: null, posterior: 'nuevo' }],
      },
      TOKEN,
    );
    expect(creado.estado).toBe(201);
    expect(creado.cuerpo.id).toBeDefined();

    const bitacora = await getBitacora(`?tabla=prueba&registroId=${marca}`);
    expect(bitacora.estado).toBe(200);
    expect(bitacora.cuerpo.total).toBeGreaterThanOrEqual(1);
    expect(bitacora.cuerpo.data[0]).toMatchObject({ tablaAfectada: 'prueba', servicio: 'audit-service-test' });
    // El actor es el del token, no uno inventado por el cliente.
    expect(bitacora.cuerpo.data[0].usuarioId).toBeDefined();
  });

  it('sin token el POST es 401: no existe forma de registrar un evento sin sesión', async () => {
    const respuesta = await postEvento({
      tabla: 'prueba',
      servicio: 'audit-service-test',
      accion: 'insert',
    });
    expect(respuesta.estado).toBe(401);
  });

  it('usuarioId en el cuerpo es 400, aunque el token sea de otro usuario válido', async () => {
    const respuesta = await postEvento(
      {
        tabla: 'prueba',
        servicio: 'audit-service-test',
        accion: 'insert',
        usuarioId: '00000000-0000-4000-8000-000000000000',
      },
      TOKEN,
    );
    expect(respuesta.estado).toBe(400);
  });

  it('ejecutar_corrida es una acción válida', async () => {
    const creado = await postEvento(
      {
        tabla: 'corridas_apriori',
        servicio: 'algorithms-core',
        accion: 'ejecutar_corrida',
        descripcion: 'Corrida de prueba.',
      },
      TOKEN,
    );
    expect(creado.estado).toBe(201);
  });

  (TOKEN_PROVEEDOR ? it : it.skip)(
    'un Proveedor puede reportar un evento propio, con su id del token',
    async () => {
      const creado = await postEvento(
        {
          tabla: 'precios_propuestos_proveedor',
          servicio: 'pricing-service',
          accion: 'insert',
          descripcion: 'Propuesta de prueba.',
        },
        TOKEN_PROVEEDOR,
      );
      expect(creado.estado).toBe(201);
    },
  );

  it('sin token el GET es 401', async () => {
    const respuesta = await fetch(`${BASE}/v1/auditoria`);
    expect(respuesta.status).toBe(401);
  });
});
