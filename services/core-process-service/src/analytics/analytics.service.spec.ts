import { AnalyticsService } from './analytics.service';

/** QueryBuilder falso: terminales con valores prefijados, sin Postgres. */
function qbFalso(crudo: { uno?: object | null; varios?: object[] }) {
  const cadena: Record<string, unknown> = {};
  for (const metodo of ['select', 'addSelect', 'andWhere', 'innerJoin', 'groupBy', 'addGroupBy', 'orderBy', 'addOrderBy']) {
    cadena[metodo] = jest.fn().mockReturnThis();
  }
  cadena['getRawOne'] = jest.fn().mockResolvedValue(crudo.uno ?? null);
  cadena['getRawMany'] = jest.fn().mockResolvedValue(crudo.varios ?? []);
  return cadena;
}

function servicio(crudo: { uno?: object | null; varios?: object[] }) {
  const qb = qbFalso(crudo);
  return new AnalyticsService({ createQueryBuilder: () => qb } as never);
}

describe('AnalyticsService (M09 portado)', () => {
  it('promedios: redondea a 2 y da 0 sin canastas', async () => {
    const s = servicio({ uno: { value: '10.456' } });
    expect(await s.getAverageTicket({})).toBe(10.46);
    expect(await new AnalyticsService({ createQueryBuilder: () => qbFalso({ uno: null }) } as never)
      .getProductsPerBasket({})).toBe(0);
  });

  it('frecuencia: canastas entre meses del periodo', async () => {
    const s = servicio({ uno: { baskets: '60', dataStart: '2026-08-01', dataEnd: '2026-10-01' } });
    // 60 canastas / 2 meses calendario exactos = 30.
    expect(await s.getPurchaseFrequency({})).toBe(30);
  });

  it('gasto por categoría: convierte NUMERIC de texto a número', async () => {
    const s = servicio({ varios: [
      { categoryId: 3, categoryName: 'Lácteos', totalSpend: '1520.50', units: '42', basketCount: '18', share: '23.75' },
    ] });
    const [fila] = await s.getSpendByCategory({});
    expect(fila).toMatchObject({ categoryId: 3, totalSpend: 1520.5, units: 42, basketCount: 18, share: 23.75 });
  });
});
