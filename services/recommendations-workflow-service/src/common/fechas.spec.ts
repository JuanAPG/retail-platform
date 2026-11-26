import { esFechaValida, finDelDia, inicioDelDia } from './fechas';

describe('días locales de America/Monterrey', () => {
  it('el día empieza a las 06:00 UTC (Monterrey es UTC−6 todo el año)', () => {
    expect(inicioDelDia('2026-10-10', 'America/Monterrey').toISOString()).toBe('2026-10-10T06:00:00.000Z');
    expect(finDelDia('2026-10-10', 'America/Monterrey').toISOString()).toBe('2026-10-11T06:00:00.000Z');
  });

  it('fin de mes y fin de año', () => {
    expect(finDelDia('2026-12-31', 'America/Monterrey').toISOString()).toBe('2027-01-01T06:00:00.000Z');
  });

  it('respeta el horario de verano de otra zona', () => {
    expect(inicioDelDia('2026-07-01', 'America/New_York').toISOString()).toBe('2026-07-01T04:00:00.000Z');
  });

  it('valida YYYY-MM-DD y que la fecha exista', () => {
    expect(esFechaValida('2026-02-28')).toBe(true);
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('2026-2-3')).toBe(false);
    expect(esFechaValida('2026-10-10T00:00:00Z')).toBe(false);
  });
});
