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
