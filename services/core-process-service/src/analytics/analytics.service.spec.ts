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
      expect(sql).toContain('basket.date >= :dateFrom');
      // Día completo, igual que M06 y M07.
      expect(sql).toContain('basket.date < CAST(:dateTo AS date) + 1');
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
