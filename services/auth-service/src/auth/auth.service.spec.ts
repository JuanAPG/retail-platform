import { AuthService, aSegundos } from './auth.service';
import { getRedis } from '../common/auth/redis.client';

jest.mock('../common/auth/redis.client', () => ({ getRedis: jest.fn() }));
jest.mock('bcryptjs', () => ({
  compare: jest.fn().mockResolvedValue(true),
  hash: jest.fn().mockResolvedValue('hash-falso'),
}));

describe('aSegundos (TTL de Redis)', () => {
  it('convierte minutos, horas y días', () => {
    expect(aSegundos('15m')).toBe(900);
    expect(aSegundos('7d')).toBe(604800);
    expect(aSegundos('3600')).toBe(3600);
  });

  it('ante formato desconocido cae a 15 minutos', () => {
    expect(aSegundos('quince')).toBe(900);
  });
});

/**
 * `usuarioId`/`rolId` YA NO van en el cuerpo de `reportar()` (audit-service
 * los toma del token, no del cuerpo). Lo que importa probar aquí es QUÉ
 * token se reenvía en cada caso, porque los tres tienen una historia
 * distinta: login/refresh usan el que acaban de emitir, logout tiene que
 * reportar ANTES de borrar su propia sesión.
 */
describe('AuthService — a quién se le reenvía el Authorization al auditar', () => {
  function construir() {
    const store = new Map<string, string>();
    const redis = {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
      del: jest.fn(async (k: string) => {
        store.delete(k);
        return 1;
      }),
      exists: jest.fn(async () => 0),
    };
    (getRedis as jest.Mock).mockReturnValue(redis);

    const usuario = {
      id: 'u1',
      email: 'a@x.mx',
      passwordHash: 'hash-falso',
      rolId: 2,
      activo: true,
      rol: { nombre: 'Analista comercial' },
    };
    const usersService = {
      findByEmail: jest.fn().mockResolvedValue(usuario),
      findById: jest.fn().mockResolvedValue(usuario),
      toPublic: jest.fn((u: typeof usuario) => ({ id: u.id, email: u.email })),
    };
    // Tokens falsos pero decodificables: el propio JSON del payload, para
    // poder simular login → refresh → logout con los jti reales que se
    // fueron generando, sin necesitar un JwtService de verdad.
    const jwtService = {
      signAsync: jest.fn(async (payload: object) => JSON.stringify(payload)),
      verifyAsync: jest.fn(async (token: string) => JSON.parse(token)),
    };
    const configValores: Record<string, unknown> = {
      'jwt.accessSecret': 'secreto-access',
      'jwt.refreshSecret': 'secreto-refresh',
      'jwt.accessExpiresIn': '15m',
      'jwt.refreshExpiresIn': '7d',
      'jwt.bcryptSaltRounds': 10,
    };
    const configService = { getOrThrow: jest.fn((k: string) => configValores[k]) };
    const auditoria = { reportar: jest.fn().mockResolvedValue(undefined) };
    const rolesRepo = { findOne: jest.fn() };
    const dataSource = { transaction: jest.fn() };

    const servicio = new AuthService(
      usersService as never,
      jwtService as never,
      configService as never,
      dataSource as never,
      auditoria as never,
      rolesRepo as never,
    );
    return { servicio, redis, usuario, auditoria };
  }

  it('login reenvía el accessToken recién emitido, sin usuarioId/rolId en el cuerpo', async () => {
    const { servicio, auditoria } = construir();

    const resultado = await servicio.login({ email: 'a@x.mx', password: 'x' }, '1.2.3.4');

    expect(auditoria.reportar).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'usuarios',
        accion: 'login',
        descripcion: expect.stringContaining('Inicio de sesión'),
        ip: '1.2.3.4',
      }),
      resultado.accessToken,
    );
    const cuerpo = auditoria.reportar.mock.calls[0][0];
    expect(cuerpo).not.toHaveProperty('usuarioId');
    expect(cuerpo).not.toHaveProperty('rolId');
  });

  it('refresh reenvía el accessToken nuevo (el que rotó), no el viejo', async () => {
    const { servicio, auditoria } = construir();
    const primero = await servicio.login({ email: 'a@x.mx', password: 'x' });

    const segundo = await servicio.refresh({ refreshToken: primero.refreshToken });

    expect(segundo.accessToken).not.toBe(primero.accessToken);
    expect(auditoria.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'login', descripcion: expect.stringContaining('renovada') }),
      segundo.accessToken,
    );
  });

  it('logout reporta ANTES de borrar la sesión, con el Authorization que mandó el caller', async () => {
    const { servicio, redis, usuario, auditoria } = construir();
    await servicio.login({ email: 'a@x.mx', password: 'x' });

    const solicitante = { id: usuario.id, email: usuario.email, rol: 'Analista comercial', rolId: usuario.rolId };
    await servicio.logout(solicitante, '9.9.9.9', 'Bearer token-del-caller');

    expect(auditoria.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'login', descripcion: expect.stringContaining('Cierre de sesión') }),
      'Bearer token-del-caller',
    );
    // El orden es lo que importa: si se reportara después del `del`,
    // audit-service rechazaría el token porque la sesión ya no existiría.
    expect(auditoria.reportar.mock.invocationCallOrder[0]).toBeLessThan(
      redis.del.mock.invocationCallOrder[0],
    );
  });

  it('el alta de proveedor NO llama a auditoria.reportar (no hay sesión que reenviar)', async () => {
    const { auditoria } = construir();
    const rolesRepo = { findOne: jest.fn().mockResolvedValue({ id: 7, nombre: 'Proveedor' }) };
    const dataSource = {
      transaction: jest.fn(async (fn: (manager: unknown) => unknown) =>
        fn({
          create: (_entidad: unknown, datos: object) => datos,
          save: jest.fn().mockResolvedValue(undefined),
        }),
      ),
      getRepository: jest.fn().mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) }),
    };
    const usersService = { findByEmail: jest.fn().mockResolvedValue(null) };
    const configService = { getOrThrow: jest.fn().mockReturnValue(10) };

    const servicio = new AuthService(
      usersService as never,
      {} as never,
      configService as never,
      dataSource as never,
      auditoria as never,
      rolesRepo as never,
    );

    await servicio.registerProveedor(
      {
        razonSocial: 'Lácteos del Norte',
        rfc: 'LDN010101AAA',
        nombreContacto: 'Ana',
        email: 'ventas@lacteos.mx',
        telefono: '5555555555',
        password: 'x'.repeat(8),
      },
      '1.2.3.4',
    );

    expect(auditoria.reportar).not.toHaveBeenCalled();
  });
});
