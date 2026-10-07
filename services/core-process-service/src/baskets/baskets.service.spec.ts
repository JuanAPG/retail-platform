import { BasketsService } from './baskets.service';

/**
 * El `EntityManager` se simula con la misma superficie que usa el
 * servicio. `create`/`save` devuelven objetos NUEVOS, no la referencia que
 * recibieron: la versión anterior del doble las compartía y eso hacía
 * pasar una aserción que en TypeORM real fallaba.
 */
function managerFalso(transaccion: object | null, segmento: number | null) {
  const guardadas: Record<string, unknown>[] = [];
  return {
    guardadas,
    manager: {
      findOne: jest.fn(async () => transaccion),
      create: jest.fn((_entidad: unknown, f: object) => ({ ...f })),
      save: jest.fn(async (_entidad: unknown, f: object) => {
        const fila = { id: 'k1', ...f };
        guardadas.push(fila);
        return { ...fila };
      }),
      query: jest.fn(async () => [{ segmentId: segmento }]),
    },
  };
}

function servicio(transaccion: object | null, segmento: number | null) {
  const { manager, guardadas } = managerFalso(transaccion, segmento);
  const basketsRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(async () => guardadas[guardadas.length - 1] ?? null),
    save: jest.fn(async (f: object) => ({ ...f })),
  };
  const transactionsRepo = { findOne: jest.fn().mockResolvedValue(transaccion) };
  const dataSource = { manager, query: manager.query };
  const svc = new BasketsService(
    basketsRepo as never,
    transactionsRepo as never,
    dataSource as never,
  );
  return { svc, guardadas, manager };
}

const TRANSACCION = {
  id: 't1',
  fecha: new Date('2026-09-01T10:00:00Z'),
  store: { zonaId: 'z1' },
  details: [
    {
      quantity: '2',
      subtotal: '85.00',
      presentationId: 'pr1',
      presentation: { productoId: 'p1', producto: { esCanastaBasica: true } },
    },
    {
      quantity: '1',
      subtotal: '28.50',
      presentationId: 'pr2',
      presentation: { productoId: 'p2', producto: { esCanastaBasica: false } },
    },
  ],
};

describe('BasketsService (M07)', () => {
  it('construye 1 canasta por transacción con zona congelada y clasifica segmento', async () => {
    const { svc, guardadas } = servicio(TRANSACCION, 2);
    const canasta = await svc.buildFromTransaction('t1');
    expect(canasta).toMatchObject({ transactionId: 't1', zoneId: 'z1', segmentId: 2 });
    // El segmento queda PERSISTIDO, no solo en el objeto devuelto.
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]).toMatchObject({ segmentId: 2 });
  });

  it('hereda conteos del detalle (valor, productos, unidades, básicos)', async () => {
    const { svc, guardadas } = servicio(TRANSACCION, null);
    await svc.buildFromTransaction('t1');
    expect(guardadas[0]).toMatchObject({
      totalValue: '113.50',
      productCount: 2,
      unitsTotal: '3.00',
      basicProductsCount: 1,
      segmentId: null,
    });
  });

  it('numero_productos cuenta productos DISTINTOS, no líneas de detalle', async () => {
    // Dos presentaciones (500 ml y 1 L) del MISMO producto: 2 líneas, pero
    // un solo producto distinto.
    const dosPresentacionesUnProducto = {
      ...TRANSACCION,
      details: [
        {
          quantity: '1',
          subtotal: '25.00',
          presentationId: 'pr-1l',
          presentation: { productoId: 'leche', producto: { esCanastaBasica: true } },
        },
        {
          quantity: '3',
          subtotal: '45.00',
          presentationId: 'pr-500',
          presentation: { productoId: 'leche', producto: { esCanastaBasica: true } },
        },
      ],
    };
    const { svc, guardadas } = servicio(dosPresentacionesUnProducto, 2);
    await svc.buildFromTransaction('t1');
    expect(guardadas[0]).toMatchObject({
      productCount: 1,
      unitsTotal: '4.00',
      totalValue: '70.00',
    });
  });

  it('basicProductsCount cuenta productos distintos, igual que productCount', async () => {
    // Dos presentaciones del MISMO producto básico: 2 líneas, 1 producto.
    // Contar líneas aquí y productos distintos allá violaba el CHECK
    // `productos_basicos <= numero_productos` y reventaba la venta con 500.
    const dosPresentacionesBasicas = {
      ...TRANSACCION,
      details: [
        {
          quantity: '1',
          subtotal: '25.00',
          presentationId: 'pr-1l',
          presentation: { productoId: 'leche', producto: { esCanastaBasica: true } },
        },
        {
          quantity: '2',
          subtotal: '30.00',
          presentationId: 'pr-500',
          presentation: { productoId: 'leche', producto: { esCanastaBasica: true } },
        },
      ],
    };
    const { svc, guardadas } = servicio(dosPresentacionesBasicas, 2);
    await svc.buildFromTransaction('t1');

    expect(guardadas[0]).toMatchObject({ productCount: 1, basicProductsCount: 1 });
    // El invariante de la tabla, comprobado explícitamente.
    expect(guardadas[0].basicProductsCount as number).toBeLessThanOrEqual(
      guardadas[0].productCount as number,
    );
  });

  it('nunca produce basicProductsCount > productCount (invariante de la tabla)', async () => {
    const casos = [
      // Mezcla: 2 productos, ambos básicos, uno con dos presentaciones.
      [
        { p: 'leche', basico: true },
        { p: 'leche', basico: true },
        { p: 'pan', basico: true },
      ],
      // Ninguno básico.
      [
        { p: 'refresco', basico: false },
        { p: 'refresco', basico: false },
      ],
      // Tres presentaciones del mismo producto básico.
      [
        { p: 'frijol', basico: true },
        { p: 'frijol', basico: true },
        { p: 'frijol', basico: true },
      ],
    ];
    for (const lineas of casos) {
      const transaccion = {
        ...TRANSACCION,
        details: lineas.map((l, i) => ({
          quantity: '1',
          subtotal: '10.00',
          presentationId: `pr${i}`,
          presentation: { productoId: l.p, producto: { esCanastaBasica: l.basico } },
        })),
      };
      const { svc, guardadas } = servicio(transaccion, 2);
      await svc.buildFromTransaction('t1');
      const canasta = guardadas[0];
      expect(canasta.basicProductsCount as number).toBeLessThanOrEqual(
        canasta.productCount as number,
      );
    }
  });

  it('usa el EntityManager que recibe, para correr dentro de la transacción de BD', async () => {
    const { svc, manager } = servicio(TRANSACCION, 2);
    const propio = managerFalso(TRANSACCION, 7);
    await svc.buildFromTransaction('t1', propio.manager as never);
    // Todo salió por el manager de la transacción, no por el del DataSource.
    expect(propio.manager.save).toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(propio.guardadas[0]).toMatchObject({ segmentId: 7 });
  });

  it('zona sin clasificación vigente: canasta con segmento nulo, sin fallar', async () => {
    const { svc, guardadas } = servicio(TRANSACCION, null);
    await expect(svc.buildFromTransaction('t1')).resolves.toBeDefined();
    expect(guardadas[0]).toMatchObject({ segmentId: null });
  });

  it('sin transacción lanza 404', async () => {
    const { svc } = servicio(null, null);
    await expect(svc.buildFromTransaction('x')).rejects.toThrow('No existe la transacción x.');
  });
});

describe('BasketsService.findAll (filtros y paginación)', () => {
  function conQueryBuilder(filtros: object) {
    const condiciones: { sql: string; params: object }[] = [];
    const qb: Record<string, jest.Mock> = {};
    for (const metodo of [
      'leftJoinAndSelect',
      'innerJoin',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
      qb[metodo] = jest.fn(() => qb);
    }
    qb.andWhere = jest.fn((sql: string, params: object = {}) => {
      condiciones.push({ sql, params });
      return qb;
    });
    qb.getManyAndCount = jest.fn(async () => [[], 0]);

    const basketsRepo = { createQueryBuilder: jest.fn(() => qb) };
    const svc = new BasketsService(
      basketsRepo as never,
      { findOne: jest.fn() } as never,
      { manager: {} } as never,
    );
    return { svc, qb, condiciones, filtros };
  }

  it('aplica los 9 filtros y todos con AND (intersección, nunca unión)', async () => {
    const { svc, qb, condiciones } = conQueryBuilder({});
    await svc.findAll({
      storeId: 't1',
      zoneId: 'z1',
      segmentId: 2,
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      minTotalValue: 100,
      maxTotalValue: 500,
      minProductCount: 2,
      maxProductCount: 10,
      hasBasicProducts: true,
      size: 'mediana',
    } as never);

    const sql = condiciones.map((c) => c.sql).join(' | ');
    expect(sql).toContain('basket.zoneId = :zoneId');
    expect(sql).toContain('basket.segmentId = :segmentId');
    expect(sql).toContain('basket.date >= :dateFrom');
    expect(sql).toContain('transaction.storeId = :storeId');
    expect(sql).toContain('basket.totalValue >= :minTotalValue');
    expect(sql).toContain('basket.totalValue <= :maxTotalValue');
    expect(sql).toContain('basket.productCount >= :minProductCount');
    expect(sql).toContain('basket.productCount <= :maxProductCount');
    expect(sql).toContain('basket.basicProductsCount > 0');
    expect(sql).toContain('tamanos_compra');
    // Ningún `.where()` que reemplace al anterior, ningún `orWhere`.
    expect(qb.where).toBeUndefined();
    expect(sql).not.toContain('orWhere');
  });

  it('dateTo toma el día completo, igual que M09', async () => {
    const { svc, condiciones } = conQueryBuilder({});
    await svc.findAll({ dateTo: '2026-09-30' } as never);
    expect(condiciones[0].sql).toBe('basket.date < CAST(:dateTo AS date) + 1');
  });

  it('hasBasicProducts=false filtra las que no traen ninguno', async () => {
    const { svc, condiciones } = conQueryBuilder({});
    await svc.findAll({ hasBasicProducts: false } as never);
    expect(condiciones[0].sql).toBe('basket.basicProductsCount = 0');
  });

  it('devuelve la envoltura paginada estándar, no un arreglo plano', async () => {
    const { svc } = conQueryBuilder({});
    const r = await svc.findAll({ page: 2, limit: 5 } as never);
    expect(r).toEqual({ data: [], total: 0, page: 2, limit: 5 });
  });

  it('sin resultados devuelve data vacía, no error', async () => {
    const { svc } = conQueryBuilder({});
    await expect(svc.findAll({ dateFrom: '2099-01-01' } as never)).resolves.toMatchObject({
      data: [],
      total: 0,
    });
  });
});

describe('BasketsService.classifyPending (rellena segmentos faltantes)', () => {
  function servicioConPendientes(
    sinSegmento: { id: string; zoneId: string }[],
    segmentoPorZona: Record<string, number | null>,
  ) {
    const actualizaciones: { ids: string[]; segmentId: number }[] = [];
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['select', 'addSelect', 'where', 'andWhere']) qb[m] = jest.fn(() => qb);
    qb.getRawMany = jest.fn(async () => sinSegmento);

    const basketsRepo = {
      createQueryBuilder: jest.fn(() => qb),
      update: jest.fn(async (criterio: { id?: { _value?: string[] } }, cambios: { segmentId: number }) => {
        actualizaciones.push({
          ids: (criterio.id as { _value?: string[] })?._value ?? [],
          segmentId: cambios.segmentId,
        });
      }),
      findOne: jest.fn(),
      save: jest.fn(),
    };
    const dataSource = {
      manager: {
        query: jest.fn(async (_sql: string, params: unknown[]) => {
          const segmento = segmentoPorZona[params[0] as string];
          return segmento == null ? [] : [{ segmentId: segmento }];
        }),
      },
    };
    const svc = new BasketsService(basketsRepo as never, { findOne: jest.fn() } as never, dataSource as never);
    return { svc, actualizaciones, dataSource, qb };
  }

  it('rellena las canastas cuya zona ya tiene clasificación vigente', async () => {
    const { svc, actualizaciones } = servicioConPendientes(
      [
        { id: 'k1', zoneId: 'z1' },
        { id: 'k2', zoneId: 'z1' },
        { id: 'k3', zoneId: 'z2' },
      ],
      { z1: 3, z2: 5 },
    );

    const r = await svc.classifyPending();

    expect(r).toEqual({
      canastasSinSegmento: 3,
      canastasClasificadas: 3,
      zonasSinClasificacion: [],
    });
    expect(actualizaciones).toEqual([
      { ids: ['k1', 'k2'], segmentId: 3 },
      { ids: ['k3'], segmentId: 5 },
    ]);
  });

  it('deja pendientes las zonas que siguen sin clasificar, y las reporta', async () => {
    const { svc, actualizaciones } = servicioConPendientes(
      [
        { id: 'k1', zoneId: 'z1' },
        { id: 'k2', zoneId: 'sin-clasificar' },
      ],
      { z1: 3, 'sin-clasificar': null },
    );

    const r = await svc.classifyPending();

    expect(r.canastasSinSegmento).toBe(2);
    expect(r.canastasClasificadas).toBe(1);
    expect(r.zonasSinClasificacion).toEqual(['sin-clasificar']);
    // No se inventa un segmento para la zona sin clasificar.
    expect(actualizaciones).toEqual([{ ids: ['k1'], segmentId: 3 }]);
  });

  it('consulta cada zona UNA vez, no una por canasta', async () => {
    const { svc, dataSource } = servicioConPendientes(
      Array.from({ length: 50 }, (_, i) => ({ id: `k${i}`, zoneId: i % 2 ? 'z1' : 'z2' })),
      { z1: 1, z2: 2 },
    );
    await svc.classifyPending();
    expect(dataSource.manager.query).toHaveBeenCalledTimes(2);
  });

  it('sin canastas pendientes no toca la base', async () => {
    const { svc, actualizaciones, dataSource } = servicioConPendientes([], {});
    const r = await svc.classifyPending();
    expect(r).toEqual({
      canastasSinSegmento: 0,
      canastasClasificadas: 0,
      zonasSinClasificacion: [],
    });
    expect(actualizaciones).toEqual([]);
    expect(dataSource.manager.query).not.toHaveBeenCalled();
  });

  it('filtra por zona cuando se le pide', async () => {
    const { svc, qb } = servicioConPendientes([{ id: 'k1', zoneId: 'z1' }], { z1: 4 });
    await svc.classifyPending({ zoneId: 'z1' });
    expect(qb.andWhere).toHaveBeenCalledWith('basket.zoneId = :zoneId', { zoneId: 'z1' });
  });

  it('solo mira las que tienen segmento NULO: no reescribe historia (RN-02)', async () => {
    const { svc, qb } = servicioConPendientes([], {});
    await svc.classifyPending();
    expect(qb.where).toHaveBeenCalledWith('basket.segmentId IS NULL');
  });
});
