import { AnalyticsService, SIN_CATEGORIA } from './analytics.service';

/**
 * QueryBuilder falso que REGISTRA la cadena de llamadas, no solo devuelve
 * valores prefijados.
 *
 * La versión anterior resolvía con `mockReturnThis()` sin mirar la
 * consulta, así que borrar los `andWhere` de los filtros o cambiar un
 * LEFT JOIN por INNER dejaba las pruebas en verde. Registrar las llamadas
 * permite afirmar sobre el SQL que se arma.
 */
function qbFalso(crudo: { uno?: object | null; varios?: object[] } = {}) {
  const llamadas: { metodo: string; args: unknown[] }[] = [];
  const cadena: Record<string, unknown> = {};
  for (const metodo of [
    'select',
    'addSelect',
    'andWhere',
    'innerJoin',
    'leftJoin',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'addOrderBy',
    // El periodo de la frecuencia liga el huso como parámetro.
    'setParameter',
  ]) {
    cadena[metodo] = jest.fn((...args: unknown[]) => {
      llamadas.push({ metodo, args });
      return cadena;
    });
  }
  cadena['getRawOne'] = jest.fn().mockResolvedValue(crudo.uno ?? null);
  cadena['getRawMany'] = jest.fn().mockResolvedValue(crudo.varios ?? []);
  cadena['__llamadas'] = llamadas;
  return cadena;
}

function servicio(crudo: { uno?: object | null; varios?: object[] } = {}) {
  const qb = qbFalso(crudo);
  const svc = new AnalyticsService({ createQueryBuilder: () => qb } as never);
  const llamadas = qb['__llamadas'] as { metodo: string; args: unknown[] }[];
  return {
    svc,
    llamadas,
    /** Todo el SQL que se le pasó al QueryBuilder, concatenado. */
    sql: () => llamadas.flatMap((l) => l.args.filter((a) => typeof a === 'string')).join(' | '),
    joins: () => llamadas.filter((l) => l.metodo.endsWith('Join')),
  };
}

describe('AnalyticsService — cálculo', () => {
  it('promedios: redondea a 2 y da 0 sin canastas', async () => {
    expect(await servicio({ uno: { value: '10.456' } }).svc.getAverageTicket({})).toBe(10.46);
    expect(await servicio({ uno: null }).svc.getProductsPerBasket({})).toBe(0);
    expect(await servicio({ uno: { value: null } }).svc.getUnitsPerTransaction({})).toBe(0);
  });

  it('cada indicador promedia SU columna de la canasta', async () => {
    const casos: [keyof AnalyticsService, string][] = [
      ['getAverageTicket', 'AVG(basket.totalValue)'],
      ['getProductsPerBasket', 'AVG(basket.productCount)'],
      ['getUnitsPerTransaction', 'AVG(basket.unitsTotal)'],
    ];
    for (const [metodo, esperado] of casos) {
      const s = servicio({ uno: { value: '1' } });
      await (s.svc[metodo] as (f: object) => Promise<number>)({});
      expect(s.sql()).toContain(esperado);
    }
  });

  it('frecuencia: canastas entre meses del periodo', async () => {
    const s = servicio({ uno: { baskets: '60', dataStart: '2026-08-01', dataEnd: '2026-10-01' } });
    // 60 canastas / 2 meses calendario exactos = 30.
    expect(await s.svc.getPurchaseFrequency({})).toBe(30);
  });

  it('frecuencia: el rango explícito manda sobre el de los datos', async () => {
    // 224 canastas en agosto: dateTo es inclusivo, así que el periodo es
    // 2026-08-01 → 2026-09-01 = 1 mes exacto.
    const s = servicio({ uno: { baskets: '224', dataStart: '2026-08-01', dataEnd: '2026-10-01' } });
    expect(
      await s.svc.getPurchaseFrequency({ dateFrom: '2026-08-01', dateTo: '2026-08-31' }),
    ).toBe(224);
  });

  it('frecuencia: periodo invertido o sin canastas da 0, nunca NaN', async () => {
    const vacio = servicio({ uno: { baskets: '0', dataStart: null, dataEnd: null } });
    expect(await vacio.svc.getPurchaseFrequency({})).toBe(0);

    const invertido = servicio({
      uno: { baskets: '10', dataStart: '2026-08-01', dataEnd: '2026-10-01' },
    });
    const r = await invertido.svc.getPurchaseFrequency({
      dateFrom: '2026-09-30',
      dateTo: '2026-09-01',
    });
    expect(r).toBe(0);
    expect(Number.isNaN(r)).toBe(false);
  });
});

describe('AnalyticsService — filtros (se aplican de verdad)', () => {
  const FILTROS = {
    storeId: 't1',
    zoneId: 'z1',
    segmentId: 2,
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
  };

  const METODOS: (keyof AnalyticsService)[] = [
    'getAverageTicket',
    'getProductsPerBasket',
    'getUnitsPerTransaction',
    'getPurchaseFrequency',
    'getSpendByCategory',
  ];

  it('los 5 filtros llegan a la consulta en los 5 indicadores', async () => {
    for (const metodo of METODOS) {
      const s = servicio({
        uno: { value: '1', baskets: '1', dataStart: '2026-09-01', dataEnd: '2026-10-01' },
        varios: [],
      });
      await (s.svc[metodo] as (f: object) => Promise<unknown>)(FILTROS);
      const sql = s.sql();

      expect(sql).toContain('basket.zoneId = :zoneId');
      expect(sql).toContain('basket.segmentId = :segmentId');
      // Días completos LOCALES en los dos extremos, igual que M06 y M07.
      expect(sql).toContain('basket.date >= CAST(:dateFrom AS date)::timestamp AT TIME ZONE :zona');
      expect(sql).toContain('basket.date < (CAST(:dateTo AS date) + 1)::timestamp AT TIME ZONE :zona');
      expect(sql).toContain('transaction.storeId = :storeId');
    }
  });

  it('sin filtros no se agregan condiciones ni el join a transacciones', async () => {
    const s = servicio({ uno: { value: '1' } });
    await s.svc.getAverageTicket({});
    expect(s.llamadas.filter((l) => l.metodo === 'andWhere')).toHaveLength(0);
    expect(s.joins()).toHaveLength(0);
  });
});

describe('AnalyticsService — gasto por categoría', () => {
  const FILA = {
    categoryId: 3,
    categoryName: 'Lácteos',
    totalSpend: '1520.50',
    units: '42',
    basketCount: '18',
    share: '23.75',
  };

  it('convierte los NUMERIC y COUNT que Postgres devuelve como texto', async () => {
    const [fila] = await servicio({ varios: [FILA] }).svc.getSpendByCategory({});
    expect(fila).toEqual({
      categoryId: 3,
      categoryName: 'Lácteos',
      totalSpend: 1520.5,
      units: 42,
      basketCount: 18,
      share: 23.75,
    });
  });

  it('el join a categoría es LEFT, no INNER', async () => {
    // Con INNER, un producto sin categoría desaparecía del resultado y los
    // `share` seguían sumando 100 % sobre un total incompleto: el gasto se
    // perdía sin que nada lo delatara.
    const s = servicio({ varios: [FILA] });
    await s.svc.getSpendByCategory({});

    const joinCategoria = s.joins().find((j) => String(j.args[0]) === 'product.categoria');
    expect(joinCategoria).toBeDefined();
    expect(joinCategoria!.metodo).toBe('leftJoin');
    // El detalle y el producto sí son INNER: una línea sin presentación no
    // existe (FK NOT NULL).
    expect(s.joins().find((j) => String(j.args[0]) === 'detail.presentation')!.metodo).toBe(
      'innerJoin',
    );
  });

  it('un producto sin categoría se agrupa como "Sin categoría", no desaparece', async () => {
    const s = servicio({
      varios: [
        FILA,
        {
          categoryId: null,
          categoryName: SIN_CATEGORIA,
          totalSpend: '200.00',
          units: '5',
          basketCount: '3',
          share: '11.62',
        },
      ],
    });
    const filas = await s.svc.getSpendByCategory({});

    expect(filas).toHaveLength(2);
    const sinCategoria = filas[1];
    // `null`, no 0: 0 sería un id de categoría que no existe.
    expect(sinCategoria.categoryId).toBeNull();
    expect(sinCategoria.categoryName).toBe(SIN_CATEGORIA);
    expect(sinCategoria.totalSpend).toBe(200);
    // El COALESCE que pone la etiqueta va en la consulta.
    expect(s.sql()).toContain(SIN_CATEGORIA);
  });

  it('ordena por gasto descendente y cuenta canastas DISTINTAS', async () => {
    const s = servicio({ varios: [FILA] });
    await s.svc.getSpendByCategory({});
    const sql = s.sql();
    // COUNT(DISTINCT): el join al detalle multiplica filas por línea de
    // venta, así que un COUNT(*) inflaría el número de canastas.
    expect(sql).toContain('COUNT(DISTINCT basket.id)');
    expect(sql).toContain('SUM(detail.subtotal)');
    // NULLIF evita dividir entre cero si todo el ámbito suma 0.
    expect(sql).toContain('NULLIF');
    expect(s.llamadas.find((l) => l.metodo === 'orderBy')!.args).toEqual([
      'SUM(detail.subtotal)',
      'DESC',
    ]);
  });

  it('sin canastas en el ámbito devuelve lista vacía, no error', async () => {
    await expect(servicio({ varios: [] }).svc.getSpendByCategory({})).resolves.toEqual([]);
  });

  it('share nulo (ámbito que suma 0) se reporta como 0', async () => {
    const [fila] = await servicio({
      varios: [{ ...FILA, totalSpend: '0', share: null }],
    }).svc.getSpendByCategory({});
    expect(fila.share).toBe(0);
  });
});

describe('AnalyticsService — weekly-sales (T-13)', () => {
  const PRODUCTO = '3f6c2a10-8b4e-4c1d-9a7e-1b2c3d4e5f60';
  const FILAS = [
    { weekStart: '2026-07-06', presentationId: 'p1', quantity: '214.00', transactions: '61' },
    { weekStart: '2026-07-06', presentationId: 'p2', quantity: '79.333', transactions: '48' },
  ];

  it('arma la serie: producto, semana en hora local y presentaciones por separado', async () => {
    const s = servicio({ varios: FILAS, uno: { transactions: '109', stores: '4' } });
    const r = await s.svc.getWeeklySales({ productId: PRODUCTO, zoneId: 'z1' });
    const sql = s.sql();

    // Las líneas de la canasta, filtradas por el producto de la presentación.
    expect(sql).toContain('detail.transactionId = basket.transactionId');
    expect(sql).toContain('presentation.productoId = :productId');
    // La semana se trunca en hora de Monterrey, no en UTC.
    expect(sql).toContain("date_trunc('week', basket.date AT TIME ZONE :zonaSemana)");
    // Una fila por semana Y presentación (D-06: no se mezclan).
    expect(s.llamadas.find((l) => l.metodo === 'addGroupBy')!.args).toEqual(['detail.presentationId']);
    // Instantánea y filtro de zona de la consulta base.
    expect(sql).toContain('basket.builtAt <= :asOf');
    expect(sql).toContain('basket.zoneId = :zoneId');
    // La cobertura cuenta transacciones y tiendas DISTINTAS.
    expect(sql).toContain('COUNT(DISTINCT basket.id)');
    expect(sql).toContain('COUNT(DISTINCT venta.storeId)');

    expect(r.productId).toBe(PRODUCTO);
    expect(r.weekStartsOn).toBe('monday');
    expect(r.transactions).toBe(109);
    expect(r.stores).toBe(4);
    expect(r.data).toEqual([
      { weekStart: '2026-07-06', presentationId: 'p1', quantity: 214, transactions: 61 },
      { weekStart: '2026-07-06', presentationId: 'p2', quantity: 79.33, transactions: 48 },
    ]);
  });

  it('el orden de los campos es el del XSD (xs:sequence)', async () => {
    const r = await servicio({ varios: [], uno: null }).svc.getWeeklySales({ productId: PRODUCTO });
    expect(Object.keys(r)).toEqual([
      'productId', 'zoneId', 'dateFrom', 'dateTo', 'timezone', 'weekStartsOn',
      'asOf', 'transactions', 'stores', 'data',
    ]);
  });

  it('sin ventas: 200 con data vacía y conteos en 0, no 404', async () => {
    const r = await servicio({ varios: [], uno: null }).svc.getWeeklySales({ productId: PRODUCTO });
    expect(r.data).toEqual([]);
    expect(r.transactions).toBe(0);
    expect(r.stores).toBe(0);
    expect(r.zoneId).toBeNull();
  });

  it('asOf: el enviado se respeta; sin él se usa el instante de la petición', async () => {
    const fijo = await servicio({ varios: [], uno: null }).svc.getWeeklySales({
      productId: PRODUCTO,
      asOf: '2026-11-25T18:04:11.902Z',
    });
    expect(fijo.asOf).toBe('2026-11-25T18:04:11.902Z');

    const antes = Date.now();
    const ahora = await servicio({ varios: [], uno: null }).svc.getWeeklySales({ productId: PRODUCTO });
    expect(new Date(ahora.asOf).getTime()).toBeGreaterThanOrEqual(antes);
    expect(new Date(ahora.asOf).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('rango de días invertido → 400', async () => {
    await expect(
      servicio().svc.getWeeklySales({ productId: PRODUCTO, dateFrom: '2026-09-30', dateTo: '2026-09-01' }),
    ).rejects.toThrow('dateFrom no puede ser posterior a dateTo.');
  });

  it('devuelve los días del filtro sin hora', async () => {
    const r = await servicio({ varios: [], uno: null }).svc.getWeeklySales({
      productId: PRODUCTO,
      dateFrom: '2026-07-01T10:00:00',
      dateTo: '2026-11-22',
    });
    expect(r.dateFrom).toBe('2026-07-01');
    expect(r.dateTo).toBe('2026-11-22');
  });
});

describe('AnalyticsService — basket-products (T-12)', () => {
  const GRUPO = { zoneId: '97925ca4-3845-4e68-9660-46f781957b8c', segmentId: 2 };

  /** Dos consultas: primero periodos, luego productos. */
  function conRespuestas(periodos: object[], productos: object[]) {
    const qb = qbFalso();
    qb['getRawMany'] = jest.fn().mockResolvedValueOnce(periodos).mockResolvedValueOnce(productos);
    const svc = new AnalyticsService({ createQueryBuilder: () => qb } as never);
    const llamadas = qb['__llamadas'] as { metodo: string; args: unknown[] }[];
    const sql = () => llamadas.flatMap((l) => l.args.filter((a) => typeof a === 'string')).join(' | ');
    return { svc, llamadas, sql };
  }

  it('cuenta canastas DISTINTAS por producto y filtra el grupo congelado en la canasta', async () => {
    const s = conRespuestas(
      [{ baskets: '40', stores: '1', totalSpend: '5607.50' }],
      [
        { productId: 'leche', productName: 'Leche entera', categoryId: '2', basketsWithProduct: '30', spend: '2137.50' },
        { productId: 'quinoa', productName: 'Quinoa orgánica', categoryId: '1', basketsWithProduct: '10', spend: '920.004' },
      ],
    );
    const r = await s.svc.getBasketProducts(GRUPO);
    const sql = s.sql();

    expect(sql).toContain('basket.zoneId = :zoneId');
    expect(sql).toContain('basket.segmentId = :segmentId');
    expect(sql).toContain('basket.builtAt <= :asOf');
    // Una canasta con dos presentaciones del mismo producto cuenta una vez.
    expect(sql).toContain('COUNT(DISTINCT basket.id)');
    expect(sql).toContain('presentation.producto');
    // El gasto del periodo es la misma columna que average-ticket.
    expect(sql).toContain('SUM(basket.totalValue)');
    expect(sql).toContain('COUNT(DISTINCT venta.storeId)');

    expect(r.periods).toEqual([{ periodStart: null, baskets: 40, stores: 1, totalSpend: 5607.5 }]);
    expect(r.data).toEqual([
      { periodStart: null, productId: 'leche', productName: 'Leche entera', categoryId: 2, basketsWithProduct: 30, spend: 2137.5 },
      { periodStart: null, productId: 'quinoa', productName: 'Quinoa orgánica', categoryId: 1, basketsWithProduct: 10, spend: 920 },
    ]);
  });

  it('orden estable: más canastas primero y, a igual conteo, por id', async () => {
    const s = conRespuestas([{ baskets: '0', stores: '0', totalSpend: '0' }], []);
    await s.svc.getBasketProducts(GRUPO);
    const ordenes = s.llamadas.filter((l) => l.metodo === 'addOrderBy').map((l) => l.args);
    expect(ordenes).toEqual([
      ['COUNT(DISTINCT basket.id)', 'DESC'],
      ['product.id', 'ASC'],
    ]);
  });

  it('sin groupBy no agrupa los periodos: un solo periodo aunque haya 0 canastas', async () => {
    const s = conRespuestas([{ baskets: '0', stores: '0', totalSpend: '0' }], []);
    const r = await s.svc.getBasketProducts(GRUPO);
    expect(r.periods).toEqual([{ periodStart: null, baskets: 0, stores: 0, totalSpend: 0 }]);
    expect(r.data).toEqual([]);
    expect(r.groupBy).toBeNull();
    expect(s.sql()).not.toContain('date_trunc');
  });

  it('groupBy=month trunca el mes en hora de Monterrey y lo devuelve en cada fila', async () => {
    const s = conRespuestas(
      [
        { periodStart: '2026-08-01', baskets: '54', stores: '3', totalSpend: '6000' },
        { periodStart: '2026-09-01', baskets: '46', stores: '3', totalSpend: '5000' },
      ],
      [{ periodStart: '2026-08-01', productId: 'leche', productName: 'Leche entera', categoryId: '2', basketsWithProduct: '40', spend: '1000' }],
    );
    const r = await s.svc.getBasketProducts({ ...GRUPO, groupBy: 'month' });
    expect(s.sql()).toContain("date_trunc('month', basket.date AT TIME ZONE :zonaPeriodo)");
    expect(r.groupBy).toBe('month');
    expect(r.periods.map((p) => p.periodStart)).toEqual(['2026-08-01', '2026-09-01']);
    expect(r.data[0].periodStart).toBe('2026-08-01');
  });

  it('el orden de los campos es el del XSD (xs:sequence)', async () => {
    const r = await conRespuestas([{ baskets: '0', stores: '0', totalSpend: '0' }], []).svc.getBasketProducts(GRUPO);
    expect(Object.keys(r)).toEqual([
      'zoneId', 'segmentId', 'dateFrom', 'dateTo', 'groupBy', 'timezone', 'asOf', 'periods', 'data',
    ]);
    expect(Object.keys(r.periods[0])).toEqual(['periodStart', 'baskets', 'stores', 'totalSpend']);
  });

  it('rango de días invertido → 400', async () => {
    await expect(
      conRespuestas([], []).svc.getBasketProducts({ ...GRUPO, dateFrom: '2026-09-30', dateTo: '2026-09-01' }),
    ).rejects.toThrow('dateFrom no puede ser posterior a dateTo.');
  });
});
