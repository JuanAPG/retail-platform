import { evidenceOf, findSubstitutes, priceInEffect, SubstitutionBasket } from './substitution';

const LECHE = { id: 'leche', name: 'Leche entera' };
const QUESO = { id: 'queso', name: 'Queso panela' };
const YOGUR = { id: 'yogur', name: 'Yogur natural' };

/** Una canasta con sus productos y el precio vigente de cada uno. */
const canasta = (productos: string[], precios: Record<string, number> = {}): SubstitutionBasket => ({
  products: new Set(productos),
  prices: new Map(Object.entries(precios)),
});
const repetir = (n: number, k: SubstitutionBasket) => Array.from({ length: n }, () => k);

describe('findSubstitutes: las tres pruebas sintéticas de QA (ALG-03)', () => {
  it('detecta una sustitución conocida: con la leche cara, las canastas llevan queso', () => {
    // Leche a $10 en 6 canastas y a $12 en otras 6. Con leche barata, 5 llevan
    // leche y 1 queso; con leche cara, 1 lleva leche y 5 queso. Nunca juntos.
    const canastas = [
      ...repetir(5, canasta(['leche'], { leche: 10, queso: 50 })),
      ...repetir(1, canasta(['queso'], { leche: 10, queso: 50 })),
      ...repetir(1, canasta(['leche'], { leche: 12, queso: 50 })),
      ...repetir(5, canasta(['queso'], { leche: 12, queso: 50 })),
    ];

    const [patron, ...resto] = findSubstitutes([LECHE, QUESO], canastas);

    expect(resto).toEqual([]);
    expect(patron).toMatchObject({
      originProductId: 'leche',
      targetProductId: 'queso',
      type: 'precio',
      lift: 0,
      // Correlación phi de "leche cara" con "llevó queso": (5·5 − 1·1) / 6² = 0.6667.
      priceCorrelation: 0.6667,
      score: 0.8333,
      observations: 12,
      priceVariation: 0.2,
      originFrequencyChange: -0.6667,
      targetFrequencyChange: 0.6667,
    });
    expect(patron.summary).toMatch(/^Indicio de sustitución por precio: cuando Leche entera estuvo más caro, más canastas llevaron Queso panela/);
    expect(patron.summary).toContain('No prueba que una cosa cause la otra.');
  });

  it('datos sin relación no generan pares: se compran juntos tanto como se espera (lift = 1)', () => {
    // 16 canastas: leche en 8, queso en 8 y las dos en 4 → P(A∩B) = P(A)·P(B).
    const canastas = [
      ...repetir(4, canasta(['leche', 'queso'], { leche: 10 })),
      ...repetir(4, canasta(['leche'], { leche: 12 })),
      ...repetir(4, canasta(['queso'], { leche: 10 })),
      ...repetir(4, canasta(['yogur'], { leche: 12 })),
    ];

    expect(findSubstitutes([LECHE, QUESO], canastas)).toEqual([]);
  });

  // La tercera (productos de otra categoría no se emparejan) va en
  // substitution.service.spec.ts: depende de qué productos pide el servicio.
});

describe('findSubstitutes: reglas trasladadas del monolito', () => {
  it('sin relación con el precio, el par es "preferencia", una sola vez y con origen = el de más canastas', () => {
    const canastas = [...repetir(6, canasta(['leche'])), ...repetir(4, canasta(['queso']))];

    const patrones = findSubstitutes([LECHE, QUESO], canastas);

    expect(patrones).toHaveLength(1);
    expect(patrones[0]).toMatchObject({
      originProductId: 'leche',
      targetProductId: 'queso',
      type: 'preferencia',
      priceCorrelation: null,
      priceVariation: null,
      originFrequencyChange: null,
      targetFrequencyChange: null,
    });
    expect(patrones[0].summary).toMatch(/^Indicio de sustitución por preferencia/);
  });

  it('si por azar no se esperaba verlos juntos ni una vez, no verlos juntos no es evidencia', () => {
    // 2 · 2 / 10 = 0.4 < 1.
    const canastas = [...repetir(2, canasta(['leche'])), ...repetir(2, canasta(['queso'])), ...repetir(6, canasta(['yogur']))];

    expect(findSubstitutes([LECHE, QUESO], canastas)).toEqual([]);
  });

  it('un producto con menos de 2 canastas no entra', () => {
    const canastas = [...repetir(6, canasta(['leche'])), canasta(['queso'])];

    expect(findSubstitutes([LECHE, QUESO, YOGUR], canastas)).toEqual([]);
  });
});

describe('evidenceOf: variación de precio y de frecuencia (caso de control)', () => {
  it('corta caro/barato en el punto medio del precio de A y compara la proporción de canastas', () => {
    // Leche a $10, $11 y $14 → punto medio 12: caras las de $14.
    const canastas = [
      canasta(['leche'], { leche: 10 }),
      canasta(['leche'], { leche: 11 }),
      canasta(['queso'], { leche: 11 }),
      canasta(['queso'], { leche: 14 }),
      canasta(['leche', 'queso'], { leche: 14 }),
      // Sin precio de leche: no cuenta para la evidencia.
      canasta(['queso']),
    ];

    expect(evidenceOf(LECHE, QUESO, canastas)).toEqual({
      priceVariation: 0.4, // (14 − 10) / 10
      originFrequencyChange: -0.1667, // 1/2 con leche cara − 2/3 con leche barata
      targetFrequencyChange: 0.6667, // 2/2 − 1/3
    });
  });

  it('sin precios de A todo es null; con precio constante solo la variación (0)', () => {
    expect(evidenceOf(LECHE, QUESO, [canasta(['leche'])])).toEqual({
      priceVariation: null,
      originFrequencyChange: null,
      targetFrequencyChange: null,
    });
    expect(evidenceOf(LECHE, QUESO, [canasta(['leche'], { leche: 10 }), canasta(['queso'], { leche: 10 })])).toEqual({
      priceVariation: 0,
      originFrequencyChange: null,
      targetFrequencyChange: null,
    });
  });
});

describe('priceInEffect', () => {
  const historico = [
    { store: 't1', price: 10, from: '2026-08-01', until: '2026-08-15' },
    { store: 't1', price: 12, from: '2026-08-10', until: null },
    { store: 't2', price: 99, from: '2026-08-01', until: null },
  ];

  it('toma el precio vigente de esa tienda ese día; si se traslapan, el de vigencia más reciente', () => {
    expect(priceInEffect(historico, 't1', '2026-08-05')).toBe(10);
    expect(priceInEffect(historico, 't1', '2026-08-12')).toBe(12);
    expect(priceInEffect(historico, 't1', '2026-09-30')).toBe(12);
  });

  it('antes del primer precio, o en otra tienda sin histórico, no hay precio', () => {
    expect(priceInEffect(historico, 't1', '2026-07-31')).toBeNull();
    expect(priceInEffect(historico, 't3', '2026-08-05')).toBeNull();
  });
});
