import { fotoDeVentas } from './elasticity.service';

/** Foto de los datos de una corrida de elasticidad (D-15), versión de la fuente en el linaje (D-43). */
const FILAS = [
  { presentationId: 'p1', zoneId: 'z1', period: '2026-10-05', quantity: 12, revenue: 384 },
  { presentationId: 'p1', zoneId: 'z2', period: '2026-10-05', quantity: 8, revenue: 260 },
  { presentationId: 'p2', zoneId: 'z1', period: '2026-10-12', quantity: 3.5, revenue: 98.25 },
];

describe('fotoDeVentas', () => {
  it('es un SHA-256 en hexadecimal', () => {
    expect(fotoDeVentas(FILAS)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no depende del orden en que llegan las observaciones (SQL sin ORDER BY)', () => {
    expect(fotoDeVentas([...FILAS].reverse())).toBe(fotoDeVentas(FILAS));
  });

  it('cambia si cambia cualquier cifra: otra cantidad es otra versión de los datos', () => {
    const otra = FILAS.map((f, i) => (i === 2 ? { ...f, quantity: 3.6 } : f));
    expect(fotoDeVentas(otra)).not.toBe(fotoDeVentas(FILAS));
  });

  it('el ruido de punto flotante no cambia la foto (0.1 + 0.2 vale lo mismo que 0.3)', () => {
    const conRuido = FILAS.map((f, i) => (i === 0 ? { ...f, revenue: 383.9 + 0.1 } : f));
    expect(fotoDeVentas(conRuido)).toBe(fotoDeVentas(FILAS));
  });
});
