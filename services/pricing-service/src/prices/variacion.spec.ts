import { centavos, porcentajeDeCambio, PrecioEnFechas, variacionDeTienda, variacionPorZona } from './variacion';

const DESDE = '2026-09-01';
const HASTA = '2026-10-01';

const fila = (storeId: string, zoneId: string, priceFrom: number | null, priceTo: number | null): PrecioEnFechas => ({
  storeId,
  storeName: `Tienda ${storeId}`,
  zoneId,
  zoneName: `Zona ${zoneId}`,
  priceFrom,
  priceTo,
});

/** CASO DE CONTROL del contrato (docs/contratos/pricing-service.md, T-22). */
const A = fila('A', 'Z1', 20, 22); // +2.00, +10 %
const B = fila('B', 'Z1', 30, 27); // −3.00, −10 %
const C = fila('C', 'Z1', null, 40); // abrió después: sin precio en la primera fecha

describe('variación de precio por tienda (T-22)', () => {
  it('CASO DE CONTROL: 20 → 22 son +2.00 y +10 %', () => {
    expect(variacionDeTienda(A, DESDE, HASTA)).toMatchObject({
      disponible: true,
      priceFrom: 20,
      priceTo: 22,
      change: 2,
      changePercent: 10,
      motivo: null,
    });
  });

  it('CASO DE CONTROL: 30 → 27 son −3.00 y −10 %', () => {
    expect(variacionDeTienda(B, DESDE, HASTA)).toMatchObject({ change: -3, changePercent: -10 });
  });

  it('sin cambio de precio la variación es 0, y está disponible', () => {
    expect(variacionDeTienda(fila('D', 'Z1', 15.5, 15.5), DESDE, HASTA)).toMatchObject({
      disponible: true,
      change: 0,
      changePercent: 0,
    });
  });

  it('sin precio en una de las fechas: no disponible, con motivo y SIN número (nunca 0)', () => {
    const v = variacionDeTienda(C, DESDE, HASTA);
    expect(v).toMatchObject({ disponible: false, priceFrom: null, priceTo: 40, change: null, changePercent: null });
    expect(v.motivo).toBe('La tienda no tenía precio de esta presentación el 2026-09-01.');
    expect(variacionDeTienda(fila('E', 'Z1', null, null), DESDE, HASTA).motivo).toBe(
      'La tienda no tenía precio de esta presentación el 2026-09-01 ni el 2026-10-01.',
    );
  });

  it('redondea a centavos y a 2 decimales de porcentaje', () => {
    expect(variacionDeTienda(fila('F', 'Z1', 19.9, 21.35), DESDE, HASTA)).toMatchObject({ change: 1.45, changePercent: 7.29 });
    expect(centavos(0.1 + 0.2)).toBe(0.3);
  });

  it('una base de 0 no da Infinity ni NaN: el porcentaje queda sin valor', () => {
    expect(porcentajeDeCambio(0, 10)).toBeNull();
  });
});

describe('variación de precio por zona (T-22)', () => {
  it('CASO DE CONTROL: la zona promedia A y B (25.00 → 24.50): −0.50 y −2 %; C no entra', () => {
    const tiendas = [A, B, C].map((f) => variacionDeTienda(f, DESDE, HASTA));
    expect(variacionPorZona(tiendas)).toEqual([
      {
        zoneId: 'Z1',
        zoneName: 'Zona Z1',
        stores: 3,
        comparableStores: 2,
        disponible: true,
        averageFrom: 25,
        averageTo: 24.5,
        change: -0.5,
        changePercent: -2,
        motivo: null,
      },
    ]);
  });

  it('si C entrara al promedio de la segunda fecha, parecería que el precio subió: por eso no entra', () => {
    const [zona] = variacionPorZona([A, B, C].map((f) => variacionDeTienda(f, DESDE, HASTA)));
    // (22 + 27 + 40) / 3 = 29.67 contra 25.00 daría +18.67 %, que no es un cambio de precio real.
    expect(zona.averageTo).not.toBe(29.67);
    expect(zona.changePercent).toBe(-2);
  });

  it('una zona sin tiendas comparables: no disponible, con motivo y sin números', () => {
    const [zona] = variacionPorZona([variacionDeTienda(C, DESDE, HASTA)]);
    expect(zona).toMatchObject({
      stores: 1,
      comparableStores: 0,
      disponible: false,
      averageFrom: null,
      averageTo: null,
      change: null,
      changePercent: null,
    });
    expect(zona.motivo).toMatch(/las dos fechas/);
  });

  it('cada zona se calcula aparte y salen ordenadas por nombre', () => {
    const tiendas = [fila('X', 'Z2', 10, 12), A, B].map((f) => variacionDeTienda(f, DESDE, HASTA));
    const zonas = variacionPorZona(tiendas);
    expect(zonas.map((z) => [z.zoneId, z.changePercent])).toEqual([
      ['Z1', -2],
      ['Z2', 20],
    ]);
  });
});
