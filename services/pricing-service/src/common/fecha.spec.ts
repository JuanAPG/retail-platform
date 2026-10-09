import { hoyOperacion, HOY_SQL } from './fecha';
import { esFechaCalendario } from './validators/fecha-calendario';

describe('hoyOperacion (QA-PRI53-02)', () => {
  it('a las 20:00 de Monterrey del 8-oct (02:00 UTC del 9) todavía es 8 de octubre', () => {
    expect(hoyOperacion(new Date('2026-10-09T02:00:00Z'))).toBe('2026-10-08');
  });

  it('pasada la medianoche local ya es el día siguiente', () => {
    expect(hoyOperacion(new Date('2026-10-09T06:30:00Z'))).toBe('2026-10-09');
  });

  it('el SQL usa el mismo huso, no CURRENT_DATE', () => {
    expect(HOY_SQL).toContain('America/Monterrey');
    expect(HOY_SQL).not.toContain('CURRENT_DATE');
  });
});

describe('esFechaCalendario (QA-PRI53-01)', () => {
  it.each(['2026-10-09', '2028-02-29', '2026-12-31'])('acepta %s', (f) => expect(esFechaCalendario(f)).toBe(true));

  it.each(['2026-13-45', '2026-02-30', '2026-00-00', '9999-99-99', '0000-01-01', '2027-02-29', '2026-1-1', 'hoy', '', 20261009 as never])(
    'rechaza %s',
    (f) => expect(esFechaCalendario(f)).toBe(false),
  );
});
