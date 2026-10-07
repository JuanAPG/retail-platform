import { JwtService } from '@nestjs/jwt';
import { SessionGuard } from './session.guard';
import * as cliente from './redis.client';

/**
 * Los tres pasos del estándar transversal: firma, token no revocado y
 * sesión activa en Redis. Ningún servicio confía solo en el JWT, así que
 * el caso importante es el de un token válido criptográficamente cuya
 * sesión ya no existe.
 */
const SECRETO = 'secreto-de-prueba';
const CARGA = { sub: 'u1', email: 'a@x.mx', rol: 'Analista comercial', rolId: 2 };

function contexto(authorization?: string) {
  const request: { headers: Record<string, string | undefined>; user?: unknown } = {
    headers: authorization ? { authorization } : {},
  };
  return {
    request,
    ctx: { switchToHttp: () => ({ getRequest: () => request }) } as never,
  };
}

function redisFalso(claves: Record<string, boolean>, falla = false) {
  return {
    exists: jest.fn(async (clave: string) => {
      if (falla) throw new Error('Redis no responde');
      return claves[clave] ? 1 : 0;
    }),
  };
}

describe('SessionGuard', () => {
  const jwt = new JwtService({});
  let guard: SessionGuard;
  const original = process.env.JWT_ACCESS_SECRET;

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRETO;
    guard = new SessionGuard(jwt);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (original === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = original;
  });

  const firmar = (carga: object = CARGA, opciones: object = {}) =>
    jwt.sign(carga, { secret: SECRETO, ...opciones });

  it('token válido con sesión activa pasa y puebla request.user', async () => {
    jest.spyOn(cliente, 'getRedis').mockReturnValue(redisFalso({ 'session:u1': true }) as never);
    const { ctx, request } = contexto(`Bearer ${firmar()}`);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'u1',
      email: 'a@x.mx',
      rol: 'Analista comercial',
      rolId: 2,
    });
  });

  it('token válido con la SESIÓN REVOCADA en Redis se rechaza con 401', async () => {
    // El token sigue siendo válido: lo que cambió es que `session:u1` ya no
    // está. Es el caso que prueba que el servicio no confía solo en la firma.
    jest.spyOn(cliente, 'getRedis').mockReturnValue(redisFalso({}) as never);
    const { ctx, request } = contexto(`Bearer ${firmar()}`);

    await expect(guard.canActivate(ctx)).rejects.toThrow(/Sesión inactiva/);
    expect(request.user).toBeUndefined();
  });

  it('token con jti en la lista de revocados se rechaza con 401', async () => {
    jest.spyOn(cliente, 'getRedis').mockReturnValue(
      redisFalso({ 'session:u1': true, 'revoked:j1': true }) as never,
    );
    const { ctx } = contexto(`Bearer ${firmar({ ...CARGA, jti: 'j1' })}`);

    await expect(guard.canActivate(ctx)).rejects.toThrow(/Sesión cerrada/);
  });

  it('firma inválida (otro secreto) se rechaza', async () => {
    jest.spyOn(cliente, 'getRedis').mockReturnValue(redisFalso({ 'session:u1': true }) as never);
    const ajeno = jwt.sign(CARGA, { secret: 'otro-secreto' });
    const { ctx } = contexto(`Bearer ${ajeno}`);

    await expect(guard.canActivate(ctx)).rejects.toThrow(/Token inválido o expirado/);
  });

  it('token expirado se rechaza', async () => {
    jest.spyOn(cliente, 'getRedis').mockReturnValue(redisFalso({ 'session:u1': true }) as never);
    const { ctx } = contexto(`Bearer ${firmar(CARGA, { expiresIn: '-1s' })}`);

    await expect(guard.canActivate(ctx)).rejects.toThrow(/Token inválido o expirado/);
  });

  it('sin header, sin Bearer o con esquema distinto se rechaza', async () => {
    jest.spyOn(cliente, 'getRedis').mockReturnValue(redisFalso({ 'session:u1': true }) as never);
    for (const header of [undefined, '', 'Basic abc', 'Bearer', firmar()]) {
      const { ctx } = contexto(header);
      await expect(guard.canActivate(ctx)).rejects.toThrow(/Falta el token de sesión/);
    }
  });

  it('sin JWT_ACCESS_SECRET en el entorno NO deja pasar (no hay secreto por defecto)', async () => {
    delete process.env.JWT_ACCESS_SECRET;
    jest.spyOn(cliente, 'getRedis').mockReturnValue(redisFalso({ 'session:u1': true }) as never);
    const { ctx } = contexto(`Bearer ${firmar()}`);

    await expect(guard.canActivate(ctx)).rejects.toThrow(/Token inválido o expirado/);
  });

  it('Redis caído NO abre la puerta (fail-closed)', async () => {
    jest.spyOn(cliente, 'getRedis').mockReturnValue(redisFalso({}, true) as never);
    const { ctx, request } = contexto(`Bearer ${firmar()}`);

    await expect(guard.canActivate(ctx)).rejects.toThrow();
    expect(request.user).toBeUndefined();
  });

  it('usa exactamente las claves que escribe auth-service', async () => {
    const redis = redisFalso({ 'session:u1': true });
    jest.spyOn(cliente, 'getRedis').mockReturnValue(redis as never);
    const { ctx } = contexto(`Bearer ${firmar({ ...CARGA, jti: 'j1' })}`);

    await guard.canActivate(ctx);
    expect(redis.exists).toHaveBeenCalledWith('revoked:j1');
    expect(redis.exists).toHaveBeenCalledWith('session:u1');
  });
});
