/**
 * Integración login → validate → logout → 401 (corre en la VM con Docker).
 *
 * Requiere: `docker compose up -d postgres redis auth-service` con el seed
 * cargado (`analista@retail.mx` / `Passw0rd123!`). No corre en CI sin
 * infraestructura; se ejecuta a mano:
 *
 *   npm run test:integracion
 */
const BASE = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';

async function post(ruta: string, cuerpo: object, token?: string) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

describe('flujo de sesión (integración, requiere stack)', () => {
  it('login → validate activo → logout → validate inactivo', async () => {
    const login = await post('/v1/auth/login', {
      email: 'analista@retail.mx',
      password: 'Passw0rd123!',
    });
    expect(login.estado).toBe(200);
    const { accessToken, refreshToken } = login.cuerpo as {
      accessToken: string;
      refreshToken: string;
    };

    const antes = await post('/v1/auth/validate', { token: accessToken });
    expect(antes.cuerpo).toMatchObject({ active: true });

    const adios = await post('/v1/auth/logout', {}, accessToken);
    expect(adios.estado).toBe(200);

    const despues = await post('/v1/auth/validate', { token: accessToken });
    expect(despues.cuerpo).toMatchObject({ active: false });

    // El refresh de una sesión cerrada también muere.
    const reuso = await post('/v1/auth/refresh', { refreshToken });
    expect(reuso.estado).toBe(401);
  });
});
