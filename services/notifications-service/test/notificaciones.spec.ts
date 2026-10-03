/**
 * Integración POST → GET → read → unread (corre en la VM con Docker).
 *
 * Requiere: `docker compose up -d redis notifications-service` y token de
 * Analista de auth-service. PENDIENTE Mongo: hoy el servicio usa el
 * repositorio en memoria, así que este spec queda en `skip` hasta que
 * documents-service fije el patrón y se cablee el adaptador Mongoose.
 * No corre en CI sin infraestructura; se ejecuta a mano:
 *
 *   npm run test:integracion
 */
const BASE = process.env.NOTIF_BASE_URL ?? 'http://localhost:3109';
const TOKEN = process.env.NOTIF_TOKEN ?? '';

async function post(ruta: string, cuerpo: object) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function get(ruta: string) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

describe.skip('notificaciones de punta a punta (requiere Mongo + stack)', () => {
  it('emite, lista, lee y cuenta', async () => {
    const creada = await post('/v1/notifications', {
      eventType: 'precio.propuesto',
      relatedEntityId: 'presentacion-1',
      title: 'Nuevo precio propuesto',
      message: 'Presentación a $24.00.',
      priority: 'info',
    });
    expect([200, 201]).toContain(creada.estado);

    const lista = await get('/v1/notifications');
    expect(lista.estado).toBe(200);
    expect(lista.cuerpo.total).toBeGreaterThanOrEqual(1);

    const conteo = await get('/v1/notifications/unread-count');
    expect(conteo.cuerpo.unread).toBeGreaterThanOrEqual(1);
  });
});
