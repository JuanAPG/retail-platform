import { aSegundos } from './auth.service';

describe('aSegundos (TTL de Redis)', () => {
  it('convierte minutos, horas y días', () => {
    expect(aSegundos('15m')).toBe(900);
    expect(aSegundos('7d')).toBe(604800);
    expect(aSegundos('3600')).toBe(3600);
  });

  it('ante formato desconocido cae a 15 minutos', () => {
    expect(aSegundos('quince')).toBe(900);
  });
});
