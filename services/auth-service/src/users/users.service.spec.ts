import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';

/** QueryBuilder mínimo que cumple `Paginable` sin tocar Postgres. */
function qbFalso(filas: object[]) {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([filas, filas.length]),
  };
}

describe('UsersService.findAll (paginado)', () => {
  const armar = (filas: object[]) => {
    const qb = qbFalso(filas);
    const servicio = new UsersService(
      { createQueryBuilder: () => qb } as never,
      {} as never,
      {} as ConfigService,
      { reportar: jest.fn() } as never,
    );
    return servicio;
  };

  it('devuelve {data,total,page,limit} sin password_hash', async () => {
    const servicio = armar([
      { id: 'u1', nombre: 'Ana', email: 'a@x.mx', passwordHash: '***', rolId: 1, activo: true },
      { id: 'u2', nombre: 'Beto', email: 'b@x.mx', passwordHash: '***', rolId: 2, activo: true },
    ]);
    const pagina = await servicio.findAll({ page: 1, limit: 1 });
    expect(pagina.total).toBe(2);
    expect(pagina.page).toBe(1);
    expect(pagina.limit).toBe(1);
    expect(pagina.data[0]).not.toHaveProperty('passwordHash');
    expect(pagina.data[0]).toHaveProperty('rol');
  });

  it('sin filtros usa page=1 y limit=20', async () => {
    const servicio = armar([]);
    const pagina = await servicio.findAll();
    expect(pagina).toMatchObject({ total: 0, page: 1, limit: 20, data: [] });
  });
});

/**
 * `usuarioId`/`rolId` ya no van en el cuerpo de `reportar()` (audit-service
 * los toma del token del Administrador que hace la petición, no del
 * cuerpo): lo único que estos tres métodos deben hacer es reenviar el
 * `token` que les llega del controller.
 */
describe('UsersService — auditoría sin usuarioId/rolId en el cuerpo', () => {
  const GENERICO = {
    id: 'x',
    nombre: 'X',
    email: 'x@x.mx',
    passwordHash: 'h',
    rolId: 2,
    activo: true,
    rol: { nombre: 'Analista comercial' },
  };

  /** `porId` es lo que `findOne({where:{id}})` devuelve; el email siempre está libre. */
  function armarCompleto(porId: Record<string, unknown> = GENERICO) {
    const usuariosRepo = {
      findOne: jest.fn(async (opciones: { where: { id?: string; email?: string } }) => {
        if (opciones.where.email) return null;
        return porId;
      }),
      create: jest.fn((datos: object) => datos),
      save: jest.fn(async (datos: object) => ({ id: 'nuevo-id', rol: { nombre: 'Analista comercial' }, ...datos })),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const rolesRepo = { findOne: jest.fn().mockResolvedValue({ id: 2, nombre: 'Analista comercial' }) };
    const auditoria = { reportar: jest.fn().mockResolvedValue(undefined) };
    const servicio = new UsersService(
      usuariosRepo as never,
      rolesRepo as never,
      { getOrThrow: () => 10 } as never,
      auditoria as never,
    );
    return { servicio, usuariosRepo, auditoria };
  }

  it('create() reporta el alta reenviando el token, sin usuarioId/rolId', async () => {
    const { servicio, auditoria } = armarCompleto();
    await servicio.create(
      { nombre: 'Ana', email: 'ana@x.mx', password: 'Abcdef12', rolId: 2 },
      '1.2.3.4',
      'Bearer t-admin',
    );

    expect(auditoria.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'usuarios', accion: 'insert', ip: '1.2.3.4' }),
      'Bearer t-admin',
    );
    const cuerpo = auditoria.reportar.mock.calls[0][0];
    expect(cuerpo).not.toHaveProperty('usuarioId');
    expect(cuerpo).not.toHaveProperty('rolId');
  });

  it('update() reporta el cambio reenviando el token, sin usuarioId/rolId', async () => {
    const existente = { id: 'u2', nombre: 'Beto', email: 'b@x.mx', passwordHash: 'h', rolId: 2, activo: true };
    const { servicio, auditoria } = armarCompleto(existente);

    await servicio.update('u2', { nombre: 'Beto G.' }, 'u-admin', '1.2.3.4', 'Bearer t-admin');

    expect(auditoria.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'usuarios', accion: 'update' }),
      'Bearer t-admin',
    );
    expect(auditoria.reportar.mock.calls[0][0]).not.toHaveProperty('usuarioId');
  });

  it('remove() reporta la baja reenviando el token, sin usuarioId/rolId', async () => {
    const existente = { id: 'u3', nombre: 'Caro', email: 'c@x.mx', passwordHash: 'h', rolId: 2, activo: true };
    const { servicio, auditoria } = armarCompleto(existente);

    await servicio.remove('u3', 'u-admin', '1.2.3.4', 'Bearer t-admin');

    expect(auditoria.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'usuarios', accion: 'delete' }),
      'Bearer t-admin',
    );
    expect(auditoria.reportar.mock.calls[0][0]).not.toHaveProperty('usuarioId');
  });
});
