import { esFechaCalendario, esFechaIso } from './fecha-calendario';

describe('esFechaIso (effectiveDate / observedAt)', () => {
  it.each([
    '2026-10-09',
    '2028-02-29',
    '2026-10-09T15:30',
    '2026-10-09T15:30:00Z',
    '2026-10-09T15:30:00.123Z',
    '2026-10-09T15:30:00-06:00',
    '2026-10-09T22:30:00.000Z',
  ])('acepta %s', (f) => expect(esFechaIso(f)).toBe(true));

  it.each([
    '2026-02-30', // IsDateString la aceptaba y Postgres la rechazaba con 500
    '2027-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '0000-01-01',
    '2026-10-09T25:00:00Z',
    '2026-10-09T15:61:00Z',
    '2026-10-09 15:30:00', // sin la T
    '09/10/2026',
    '2026-1-9',
    'hoy',
    '',
    '2026-10-09T',
    '2026-10-09; DROP TABLE precios',
  ])('rechaza %s', (f) => expect(esFechaIso(f)).toBe(false));

  it.each([null, undefined, 20261009, {}, [], true])('rechaza el valor no textual %p', (v) => expect(esFechaIso(v)).toBe(false));
});

describe('esFechaCalendario (dateFrom / dateTo)', () => {
  it('no acepta fecha con hora (esas son de esFechaIso)', () => {
    expect(esFechaCalendario('2026-10-09T10:00:00Z')).toBe(false);
  });

  it('acepta el último día de cada mes de un año bisiesto y rechaza el siguiente', () => {
    const dias = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    dias.forEach((d, i) => {
      const mes = String(i + 1).padStart(2, '0');
      expect(esFechaCalendario(`2028-${mes}-${String(d).padStart(2, '0')}`)).toBe(true);
      expect(esFechaCalendario(`2028-${mes}-${String(d + 1).padStart(2, '0')}`)).toBe(false);
    });
  });
});
