import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { PriceHistory } from '../entities/price-history.entity';
import { PricesService } from './prices.service';

const usuario: SesionUsuario = { id: 'u-1', email: 'precios@retail.mx', rol: 'Responsable de precios', rolId: 4 };
const dto = { presentationId: 'pres-1', storeId: 'tienda-1', price: 42.5, effectiveDate: '2026-09-14' };

const errorSql = (code: string) => Object.assign(new QueryFailedError('q', [], new Error('x')), { code });

function filaDetalle(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    presentacion_id: 'pres-1',
    tienda_id: 'tienda-1',
    precio: '42.50',
    desde: '2026-09-14',
    hasta: null,
    vigente: true,
    origen: 'interno',
    creado_por: 'u-1',
    created_at: new Date('2026-09-14T15:00:00Z'),
    producto_id: 'prod-1',
    pres_nombre: '1 kg',
    contenido: '1.000',
    unidad: 'kg',
    tienda_nombre: 'Super Valle',
    zona_id: 'zona-1',
    zona_nombre: 'Zona Valle',
    ...extra,
  };
}

function crearServicio() {
  const repo = { createQueryBuilder: jest.fn() };
  const manager = {
    findOne: jest.fn(),
    update: jest.fn(),
    create: jest.fn((_entidad, valores) => ({ ...valores })),
    save: jest.fn(async (x) => ({ id: 'nuevo-id', ...x })),
  };
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const audit = { reportar: jest.fn().mockResolvedValue(undefined) };
  const servicio = new PricesService(
    repo as unknown as Repository<PriceHistory>,
    dataSource as unknown as DataSource,
    audit as unknown as AuditReporter,
  );
  return { repo, manager, dataSource, audit, servicio };
}

/** Existen presentación y tienda; luego la consulta de detalle devuelve `detalle`. */
function existenYDetalle(dataSource: { query: jest.Mock }, detalle: unknown[]) {
  dataSource.query
    .mockResolvedValueOnce([{ '?column?': 1 }]) // presentación
    .mockResolvedValueOnce([{ '?column?': 1 }]) // tienda
    .mockResolvedValueOnce(detalle);
}

describe('PricesService.create', () => {
  it('rechaza una presentación inexistente con 400, sin abrir transacción', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([]);

    await expect(servicio.create(dto, usuario)).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rechaza una tienda inexistente con 400', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([]);

    await expect(servicio.create(dto, usuario)).rejects.toThrow(/tienda/);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('el primer precio de una pareja no cierra nada y lo fija el servidor (origen interno, creador del token)', async () => {
    const { dataSource, manager, servicio } = crearServicio();
    existenYDetalle(dataSource, [filaDetalle('nuevo-id')]);
    manager.findOne.mockResolvedValue(null);

    const precio = await servicio.create(dto, usuario);

    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.create.mock.calls[0][1]).toMatchObject({
      price: '42.5',
      effectiveDate: '2026-09-14',
      origen: 'interno',
      createdBy: 'u-1',
    });
    expect(precio).toMatchObject({
      id: 'nuevo-id',
      vigente: true,
      presentation: { unidadMedida: 'kg' },
      store: { zona: { nombre: 'Zona Valle' } },
    });
  });

  it('cierra el precio vigente un día antes de la nueva vigencia, en la misma transacción', async () => {
    const { dataSource, manager, servicio } = crearServicio();
    existenYDetalle(dataSource, [filaDetalle('nuevo-id')]);
    manager.findOne.mockResolvedValue({ id: 'previo', effectiveDate: '2026-08-01' });

    await servicio.create(dto, usuario);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.update).toHaveBeenCalledWith(PriceHistory, { id: 'previo' }, { effectiveUntil: '2026-09-13' });
  });

  it.each([
    ['2026-03-01', '2026-02-28'],
    ['2026-01-01', '2025-12-31'],
    ['2028-03-01', '2028-02-29'],
  ])('el día anterior a %s es %s (cambio de mes, año y bisiesto)', async (fecha, esperado) => {
    const { dataSource, manager, servicio } = crearServicio();
    existenYDetalle(dataSource, [filaDetalle('nuevo-id')]);
    manager.findOne.mockResolvedValue({ id: 'previo', effectiveDate: '2020-01-01' });

    await servicio.create({ ...dto, effectiveDate: fecha }, usuario);

    expect(manager.update).toHaveBeenCalledWith(PriceHistory, { id: 'previo' }, { effectiveUntil: esperado });
  });

  it('no permite fechas iguales o anteriores al precio vigente (409) y no escribe nada', async () => {
    const { dataSource, manager, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([{ x: 1 }]);
    manager.findOne.mockResolvedValue({ id: 'previo', effectiveDate: '2026-09-14' });

    await expect(servicio.create(dto, usuario)).rejects.toBeInstanceOf(ConflictException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('normaliza un ISO con hora a solo fecha', async () => {
    const { dataSource, manager, servicio } = crearServicio();
    existenYDetalle(dataSource, [filaDetalle('nuevo-id')]);
    manager.findOne.mockResolvedValue({ id: 'previo', effectiveDate: '2026-08-01' });

    await servicio.create({ ...dto, effectiveDate: '2026-09-14T22:30:00.000Z' }, usuario);

    expect(manager.create.mock.calls[0][1]).toMatchObject({ effectiveDate: '2026-09-14' });
    expect(manager.update).toHaveBeenCalledWith(PriceHistory, { id: 'previo' }, { effectiveUntil: '2026-09-13' });
  });

  it('sin fecha usa hoy', async () => {
    const { dataSource, manager, servicio } = crearServicio();
    existenYDetalle(dataSource, [filaDetalle('nuevo-id')]);
    manager.findOne.mockResolvedValue(null);

    await servicio.create({ presentationId: 'pres-1', storeId: 'tienda-1', price: 10 }, usuario);

    expect(manager.create.mock.calls[0][1].effectiveDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it('un registro simultáneo (unique_violation 23505) responde 409', async () => {
    const { dataSource, manager, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([{ x: 1 }]);
    manager.findOne.mockResolvedValue(null);
    manager.save.mockRejectedValue(errorSql('23505'));

    await expect(servicio.create(dto, usuario)).rejects.toThrow(/al mismo tiempo/);
  });

  it('otros errores de la base no se disfrazan de conflicto', async () => {
    const { dataSource, manager, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([{ x: 1 }]);
    manager.findOne.mockResolvedValue(null);
    manager.save.mockRejectedValue(new Error('conexión caída'));

    await expect(servicio.create(dto, usuario)).rejects.toThrow('conexión caída');
  });
});

describe('PricesService.create — auditoría', () => {
  it('reporta el alta con el precio anterior, el actor y la IP, después de confirmar la transacción', async () => {
    const { dataSource, manager, audit, servicio } = crearServicio();
    existenYDetalle(dataSource, [filaDetalle('nuevo-id')]);
    manager.findOne.mockResolvedValue({ id: 'previo', price: '40.00', effectiveDate: '2026-08-01' });

    await servicio.create(dto, usuario, '172.18.0.9');

    expect(audit.reportar).toHaveBeenCalledTimes(1);
    expect(audit.reportar).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'precios',
        registroId: 'nuevo-id',
        accion: 'insert',
        usuarioId: 'u-1',
        rolId: 4,
        ip: '172.18.0.9',
        cambios: [
          { campo: 'precio_anterior', previo: '40.00', posterior: null },
          { campo: 'precio', previo: null, posterior: '42.5' },
        ],
      }),
    );
    // Se reporta solo después de que la transacción terminó.
    expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(audit.reportar.mock.invocationCallOrder[0]);
  });

  it('el primer precio de una pareja reporta precio_anterior nulo', async () => {
    const { dataSource, manager, audit, servicio } = crearServicio();
    existenYDetalle(dataSource, [filaDetalle('nuevo-id')]);
    manager.findOne.mockResolvedValue(null);

    await servicio.create(dto, usuario);

    expect(audit.reportar.mock.calls[0][0].cambios[0]).toEqual({ campo: 'precio_anterior', previo: null, posterior: null });
    expect(audit.reportar.mock.calls[0][0].ip).toBeNull();
  });

  it('no reporta nada si el alta falla (validación, 409 o error de la base)', async () => {
    const { dataSource, manager, audit, servicio } = crearServicio();

    dataSource.query.mockResolvedValueOnce([]); // presentación inexistente
    await expect(servicio.create(dto, usuario)).rejects.toBeInstanceOf(BadRequestException);

    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([{ x: 1 }]);
    manager.findOne.mockResolvedValue({ id: 'previo', price: '40.00', effectiveDate: '2026-09-14' });
    await expect(servicio.create(dto, usuario)).rejects.toBeInstanceOf(ConflictException);

    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([{ x: 1 }]);
    manager.findOne.mockResolvedValue(null);
    manager.save.mockRejectedValue(errorSql('23505'));
    await expect(servicio.create(dto, usuario)).rejects.toBeInstanceOf(ConflictException);

    expect(audit.reportar).not.toHaveBeenCalled();
  });
});

describe('PricesService.findHistory', () => {
  function qbHistorial(ids: string[]) {
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['innerJoin', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'skip', 'take']) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([ids.map((id) => ({ id })), 7]);
    return qb;
  }

  it('un producto inexistente responde 404', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([]);

    await expect(servicio.findHistory({ productId: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('pagina lo más reciente primero y conserva el orden al armar el detalle', async () => {
    const { repo, dataSource, servicio } = crearServicio();
    const qb = qbHistorial(['b', 'a']);
    repo.createQueryBuilder.mockReturnValue(qb);
    // La base devuelve el detalle en otro orden: el servicio debe respetar el de la página.
    dataSource.query
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([filaDetalle('a'), filaDetalle('b')]);

    const pagina = await servicio.findHistory({ productId: 'prod-1', page: 2, limit: 2 });

    expect(qb.orderBy).toHaveBeenCalledWith('p.effectiveDate', 'DESC');
    expect(qb.skip).toHaveBeenCalledWith(2);
    expect(pagina.data.map((p) => p.id)).toEqual(['b', 'a']);
    expect(pagina).toMatchObject({ total: 7, page: 2, limit: 2 });
  });

  it('filtra por presentación solo cuando se indica', async () => {
    const { repo, dataSource, servicio } = crearServicio();
    const qb = qbHistorial([]);
    repo.createQueryBuilder.mockReturnValue(qb);
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]);

    await servicio.findHistory({ productId: 'prod-1' });
    expect(qb.andWhere).not.toHaveBeenCalled();

    dataSource.query.mockResolvedValueOnce([{ x: 1 }]);
    await servicio.findHistory({ productId: 'prod-1', presentationId: 'pres-9' });
    expect(qb.andWhere).toHaveBeenCalledWith('p.presentationId = :presentationId', { presentationId: 'pres-9' });
  });

  it('una página vacía no consulta el detalle', async () => {
    const { repo, dataSource, servicio } = crearServicio();
    repo.createQueryBuilder.mockReturnValue(qbHistorial([]));
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]);

    const pagina = await servicio.findHistory({ productId: 'prod-1' });

    expect(pagina.data).toEqual([]);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });
});

describe('PricesService.compareAcrossZones', () => {
  it('un producto inexistente responde 404', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([]);

    await expect(servicio.compareAcrossZones('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('convierte los agregados de la base (cadenas) a números', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([
      { zoneId: 'z1', zoneName: 'Centro', averagePrice: '41.2500000', minPrice: '39.90', maxPrice: '42.50', storeCount: '2' },
    ]);

    const resultado = await servicio.compareAcrossZones('prod-1');

    expect(resultado).toEqual({
      productId: 'prod-1',
      zones: [{ zoneId: 'z1', zoneName: 'Centro', averagePrice: 41.25, minPrice: 39.9, maxPrice: 42.5, storeCount: 2 }],
    });
  });

  it('sin precios vigentes devuelve zones vacío', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([]);

    expect(await servicio.compareAcrossZones('prod-1')).toEqual({ productId: 'prod-1', zones: [] });
  });
});
