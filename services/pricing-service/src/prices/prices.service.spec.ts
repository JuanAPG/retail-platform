import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { CacheService } from '../common/cache/cache.service';
import { PriceHistory } from '../entities/price-history.entity';
import { PriceAlertsService } from '../price-alerts/price-alerts.service';
import { PricesService } from './prices.service';

const usuario: SesionUsuario = { id: 'u-1', email: 'precios@retail.mx', rol: 'Responsable de precios', rolId: 4 };
const proveedor: SesionUsuario = { id: 'u-p', email: 'ventas@lacteos.mx', rol: 'Proveedor', rolId: 7 };
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
  // Caché "transparente" por omisión: siempre MISS (ejecuta la carga). Los tests de caché
  // sobreescriben `obtener` / `version` para simular HIT o una versión distinta.
  const cache = {
    version: jest.fn().mockResolvedValue(0),
    obtener: jest.fn((_clave: string, _ttl: number, cargar: () => Promise<unknown>) => cargar()),
    invalidarGrupo: jest.fn().mockResolvedValue(undefined),
  };
  const alertas = { evaluar: jest.fn().mockResolvedValue({ alerta: false, basePrecio: null, variacionPct: null }) };
  const servicio = new PricesService(
    repo as unknown as Repository<PriceHistory>,
    dataSource as unknown as DataSource,
    audit as unknown as AuditReporter,
    cache as unknown as CacheService,
    alertas as unknown as PriceAlertsService,
  );
  return { repo, manager, dataSource, audit, cache, alertas, servicio };
}

/** Existen presentación y tienda; luego la consulta de detalle devuelve `detalle`. */
function existenYDetalle(dataSource: { query: jest.Mock }, detalle: unknown[]) {
  dataSource.query
    .mockResolvedValueOnce([{ '?column?': 1 }]) // presentación
    .mockResolvedValueOnce([{ '?column?': 1 }]) // tienda
    .mockResolvedValueOnce([{ estatus: 'activo' }]) // producto activo (D-08)
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
    dataSource.query
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ estatus: 'activo' }]);
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
    dataSource.query
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ estatus: 'activo' }]);
    manager.findOne.mockResolvedValue(null);
    manager.save.mockRejectedValue(errorSql('23505'));

    await expect(servicio.create(dto, usuario)).rejects.toThrow(/al mismo tiempo/);
  });

  it('otros errores de la base no se disfrazan de conflicto', async () => {
    const { dataSource, manager, servicio } = crearServicio();
    dataSource.query
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ estatus: 'activo' }]);
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

    await servicio.create(dto, usuario, '172.18.0.9', 'Bearer t-1');

    expect(audit.reportar).toHaveBeenCalledTimes(1);
    expect(audit.reportar).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'precios',
        registroId: 'nuevo-id',
        accion: 'insert',
        ip: '172.18.0.9',
        cambios: [
          { campo: 'precio_anterior', previo: '40.00', posterior: null },
          { campo: 'precio', previo: null, posterior: '42.5' },
        ],
      }),
      'Bearer t-1',
    );
    // El actor sale del token en audit-service, no del cuerpo.
    expect(audit.reportar.mock.calls[0][0]).not.toHaveProperty('usuarioId');
    expect(audit.reportar.mock.calls[0][0]).not.toHaveProperty('rolId');
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

    dataSource.query
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ estatus: 'activo' }]);
    manager.findOne.mockResolvedValue({ id: 'previo', price: '40.00', effectiveDate: '2026-09-14' });
    await expect(servicio.create(dto, usuario)).rejects.toBeInstanceOf(ConflictException);

    dataSource.query
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ estatus: 'activo' }]);
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

    await expect(servicio.compareAcrossZones('x', usuario)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('separa por presentación (D-06): 1 L y 250 ml de la misma zona NO se promedian', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query
      .mockResolvedValueOnce([{ x: 1 }]) // producto existe
      .mockResolvedValueOnce([
        { zoneId: 'z1', zoneName: 'Oriente', presentationId: 'p1', presentationName: '1 L', averagePrice: '29.0000000', minPrice: '29.00', maxPrice: '29.00', storeCount: '1' },
        { zoneId: 'z1', zoneName: 'Oriente', presentationId: 'p2', presentationName: '250 ml', averagePrice: '99.0000000', minPrice: '99.00', maxPrice: '99.00', storeCount: '1' },
      ])
      .mockResolvedValueOnce([
        { zoneId: 'z1', zoneName: 'Oriente', baseUnit: 'l', averagePricePerBaseUnit: '212.5000000', minPricePerBaseUnit: '29.00', maxPricePerBaseUnit: '396.00', storeCount: '1' },
      ]);

    const resultado = await servicio.compareAcrossZones('prod-1', usuario);

    expect(resultado.zones).toHaveLength(2);
    expect(resultado.zones.map((z) => [z.presentationName, z.averagePrice])).toEqual([
      ['1 L', 29],
      ['250 ml', 99],
    ]);
    expect(resultado.perUnit).toEqual([
      { zoneId: 'z1', zoneName: 'Oriente', baseUnit: 'l', averagePricePerBaseUnit: 212.5, minPricePerBaseUnit: 29, maxPricePerBaseUnit: 396, storeCount: 1 },
    ]);
  });

  it('sin precios vigentes devuelve zones y perUnit vacíos', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    expect(await servicio.compareAcrossZones('prod-1', usuario)).toEqual({ productId: 'prod-1', zones: [], perUnit: [] });
  });

  it('un Proveedor solo compara productos suyos: el de otro es 404 y no toca la caché', async () => {
    const { dataSource, cache, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([]); // no es de su empresa

    await expect(servicio.compareAcrossZones('prod-ajeno', proveedor)).rejects.toBeInstanceOf(NotFoundException);
    expect(cache.obtener).not.toHaveBeenCalled();
  });

  it('un Proveedor puede comparar un producto suyo', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query
      .mockResolvedValueOnce([{ '?column?': 1 }]) // es suyo
      .mockResolvedValueOnce([{ x: 1 }]) // existe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    expect(await servicio.compareAcrossZones('prod-1', proveedor)).toEqual({ productId: 'prod-1', zones: [], perUnit: [] });
  });
});

describe('PricesService.create — producto no activo (D-08)', () => {
  it('rechaza con 409 un precio para una presentación de un producto pendiente o rechazado', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ estatus: 'pendiente_aprobacion' }]);

    await expect(servicio.create(dto, usuario)).rejects.toBeInstanceOf(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe('PricesService — caché', () => {
  it('el historial cachea con una llave que incluye producto, versión, presentación, página y límite', async () => {
    const { cache, servicio } = crearServicio();
    cache.version.mockResolvedValue(3);
    cache.obtener.mockResolvedValue({ data: [], total: 0, page: 2, limit: 10 });

    await servicio.findHistory({ productId: 'prod-1', presentationId: 'pres-1', page: 2, limit: 10 });

    expect(cache.version).toHaveBeenCalledWith('pricing:v:prod-1');
    expect(cache.obtener).toHaveBeenCalledWith('pricing:history:prod-1:v3:pres-1:p2:l10', 300, expect.any(Function));
  });

  it('la llave usa los valores por omisión y recorta el límite igual que la paginación', async () => {
    const { cache, servicio } = crearServicio();
    cache.obtener.mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });

    await servicio.findHistory({ productId: 'prod-1' });
    await servicio.findHistory({ productId: 'prod-1', limit: 5000 });

    expect(cache.obtener.mock.calls[0][0]).toBe('pricing:history:prod-1:v0:all:p1:l20');
    expect(cache.obtener.mock.calls[1][0]).toBe('pricing:history:prod-1:v0:all:p1:l100');
  });

  it('en un HIT del historial no toca la base (ni siquiera para verificar el producto)', async () => {
    const { cache, dataSource, repo, servicio } = crearServicio();
    cache.obtener.mockResolvedValue({ data: [{ id: 'a' }], total: 1, page: 1, limit: 20 });

    const pagina = await servicio.findHistory({ productId: 'prod-1' });

    expect(pagina.total).toBe(1);
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('la comparación por zonas se cachea por producto y versión', async () => {
    const { cache, servicio } = crearServicio();
    cache.version.mockResolvedValue(5);
    cache.obtener.mockResolvedValue({ productId: 'prod-1', zones: [], perUnit: [] });

    await servicio.compareAcrossZones('prod-1', usuario);

    expect(cache.obtener).toHaveBeenCalledWith('pricing:compare:prod-1:v5', 300, expect.any(Function));
  });

  it('un 404 (producto inexistente) sale de la carga y por tanto no se cachea', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([]);

    await expect(servicio.compareAcrossZones('x', usuario)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un alta exitosa invalida la caché del producto de la presentación (no de otro)', async () => {
    const { dataSource, manager, cache, servicio } = crearServicio();
    existenYDetalle(dataSource, [filaDetalle('nuevo-id', { producto_id: 'prod-77' })]);
    manager.findOne.mockResolvedValue(null);

    await servicio.create(dto, usuario);

    expect(cache.invalidarGrupo).toHaveBeenCalledTimes(1);
    expect(cache.invalidarGrupo).toHaveBeenCalledWith('pricing:v:prod-77');
  });

  it('un alta rechazada no invalida nada', async () => {
    const { dataSource, manager, cache, servicio } = crearServicio();
    dataSource.query
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ x: 1 }])
      .mockResolvedValueOnce([{ estatus: 'activo' }]);
    manager.findOne.mockResolvedValue({ id: 'previo', price: '40.00', effectiveDate: '2026-09-14' });

    await expect(servicio.create(dto, usuario)).rejects.toBeInstanceOf(ConflictException);
    expect(cache.invalidarGrupo).not.toHaveBeenCalled();
  });
});

describe('PricesService — PRI-05 (precio actual por fecha), PRI-07 (alerta) y PRI-11 (series)', () => {
  it('compare-zones define "actual" por FECHA, no por la bandera vigente: un precio futuro no cambia lo de hoy', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await servicio.compareAcrossZones('prod-1', usuario);

    for (const [sql] of dataSource.query.mock.calls.slice(1)) {
      expect(String(sql)).toContain('fecha_vigencia_desde <= CURRENT_DATE');
      expect(String(sql)).toContain('fecha_vigencia_hasta IS NULL OR p.fecha_vigencia_hasta >= CURRENT_DATE');
      expect(String(sql)).not.toMatch(/AND p\.vigente/);
    }
  });

  it('el campo vigente de cada precio también sale calculado por fecha', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([filaDetalle('a')]);
    await servicio.detallar(['a']);
    expect(String(dataSource.query.mock.calls[0][0])).toContain('fecha_vigencia_desde <= CURRENT_DATE');
  });

  it('un alta directa evalúa la alerta de cambio con el precio, la fecha y el token de quien lo registró', async () => {
    const { dataSource, manager, alertas, servicio } = crearServicio();
    existenYDetalle(dataSource, [filaDetalle('nuevo-id')]);
    manager.findOne.mockResolvedValue(null);

    await servicio.create(dto, usuario, '10.0.0.1', 'Bearer t');

    expect(alertas.evaluar).toHaveBeenCalledWith(
      { presentationId: 'pres-1', storeId: 'tienda-1', nuevoPrecio: 42.5, effectiveDate: '2026-09-14' },
      'Bearer t',
    );
  });

  it('current: exige presentación existente, filtra por zona y tienda y pagina', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([{ n: 1 }]).mockResolvedValueOnce([{ id: 'p1' }]).mockResolvedValueOnce([filaDetalle('p1')]);

    const r = await servicio.findCurrent({ presentationId: 'pres-1', zoneId: 'z1', storeId: 't1', page: 2, limit: 5 });

    expect(r).toMatchObject({ total: 1, page: 2, limit: 5 });
    const [sql, params] = dataSource.query.mock.calls[1];
    expect(String(sql)).toContain('fecha_vigencia_desde <= CURRENT_DATE');
    expect(String(sql)).toContain('t.zona_id = $3');
    expect(params).toEqual(['pres-1', 't1', 'z1']);
    expect(String(dataSource.query.mock.calls[2][0])).toContain('LIMIT 5 OFFSET 5');
  });

  it('current: una presentación inexistente es 400', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([]);
    await expect(servicio.findCurrent({ presentationId: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('series: SIN paginar (sin LIMIT), ordenada por fecha de inicio, y con rango de fechas que se cruza con la vigencia', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]).mockResolvedValueOnce([filaDetalle('a'), filaDetalle('b')]);

    const r = await servicio.findSeries({ presentationId: 'pres-1', dateFrom: '2026-01-01', dateTo: '2026-06-30' });

    expect(r).toMatchObject({ total: 2 });
    expect(r.data.map((p) => p.id)).toEqual(['a', 'b']);
    const [sql, params] = dataSource.query.mock.calls[1];
    expect(String(sql)).not.toMatch(/LIMIT/i);
    expect(String(sql)).toContain('ORDER BY p.fecha_vigencia_desde ASC');
    expect(String(sql)).toContain('p.fecha_vigencia_hasta >= $2::date');
    expect(String(sql)).toContain('p.fecha_vigencia_desde <= $3::date');
    expect(params).toEqual(['pres-1', '2026-01-01', '2026-06-30']);
  });

  it('series: un rango invertido es 400 y una presentación inexistente también', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ x: 1 }]);
    await expect(servicio.findSeries({ presentationId: 'p', dateFrom: '2026-12-01', dateTo: '2026-01-01' })).rejects.toBeInstanceOf(BadRequestException);

    dataSource.query.mockResolvedValueOnce([]);
    await expect(servicio.findSeries({ presentationId: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
