import { diaLocal, esFiltroDeFecha, filtrarDiasLocales, ZONA_HORARIA } from './zona-horaria';

describe('esFiltroDeFecha (formato de dateFrom/dateTo)', () => {
  it('acepta un día y un ISO completo (del que solo se usa el día)', () => {
    for (const valor of ['2026-09-01', '2026-12-31', '2026-09-01T10:00:00Z', '2026-09-01 10:00']) {
      expect(esFiltroDeFecha(valor)).toBe(true);
    }
  });

  /**
   * `@IsDateString()` aceptaba estos y el `CAST(... AS date)` de Postgres
   * reventaba: el filtro devolvía 500 en vez de 400.
   */
  it('acepta el 29 de febrero solo en año bisiesto', () => {
    expect(esFiltroDeFecha('2024-02-29')).toBe(true);
    expect(esFiltroDeFecha('2026-02-29')).toBe(false);
  });

  it('rechaza lo que Postgres no puede castear a date', () => {
    for (const valor of ['2026', '2026-09', '2026-W40-1', '2026-273', '2026-09-31', '2026-02-30', '2026-13-01', '2026-00-05', 'ayer', '']) {
      expect(esFiltroDeFecha(valor)).toBe(false);
    }
  });
});

describe('filtrarDiasLocales', () => {
  function qbFalso() {
    const condiciones: { sql: string; params: Record<string, unknown> }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qb: any = {
      andWhere: jest.fn((sql: string, params: Record<string, unknown>) => {
        condiciones.push({ sql, params });
        return qb;
      }),
    };
    return { qb, condiciones };
  }

  it('los dos extremos usan AT TIME ZONE con el huso del negocio', () => {
    const { qb, condiciones } = qbFalso();
    filtrarDiasLocales(qb, 'basket.date', { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(condiciones).toHaveLength(2);
    for (const c of condiciones) {
      expect(c.sql).toContain('AT TIME ZONE :zona');
      expect(c.params.zona).toBe('America/Monterrey');
    }
    expect(ZONA_HORARIA).toBe('America/Monterrey');
  });

  it('dateTo es inclusivo (hasta el final del día) y dateFrom desde las 00:00', () => {
    const { qb, condiciones } = qbFalso();
    filtrarDiasLocales(qb, 't.fecha', { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(condiciones[0].sql).toContain('>=');
    expect(condiciones[1].sql).toContain('<');
    expect(condiciones[1].sql).toContain('+ 1');
  });

  it('de un ISO completo se queda solo con el día', () => {
    const { qb, condiciones } = qbFalso();
    filtrarDiasLocales(qb, 't.fecha', { dateFrom: '2026-09-01T18:30:00Z', dateTo: '2026-09-30T23:00:00Z' });
    expect(condiciones[0].params.dateFrom).toBe('2026-09-01');
    expect(condiciones[1].params.dateTo).toBe('2026-09-30');
  });

  it('sin filtros no agrega condiciones', () => {
    const { qb, condiciones } = qbFalso();
    filtrarDiasLocales(qb, 't.fecha', {});
    expect(condiciones).toHaveLength(0);
  });
});

describe('diaLocal', () => {
  it('etiqueta el día local, no el UTC', () => {
    expect(diaLocal(new Date('2026-10-01T03:00:00Z'))).toBe('2026-09-30');
    expect(diaLocal(new Date('2026-09-01T06:00:00Z'))).toBe('2026-09-01');
  });
});
