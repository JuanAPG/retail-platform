import { apriori } from './apriori';

/**
 * Ejemplo clásico de 5 canastas (Tan, Steinbach y Kumar, "Introduction to
 * Data Mining"): los resultados se pueden calcular a mano.
 * Conteos: pan 4, leche 4, pañal 4, cerveza 3, refresco 2, huevo 1.
 */
const CANASTAS = [
  ['leche', 'pan'],
  ['pan', 'pañal', 'cerveza', 'huevo'],
  ['leche', 'pañal', 'cerveza', 'refresco'],
  ['pan', 'leche', 'pañal', 'cerveza'],
  ['pan', 'leche', 'pañal', 'refresco'],
];

describe('apriori (trasladado de M10 sin cambios)', () => {
  it('da las reglas del ejemplo de libro con soporte y confianza dados', () => {
    // Soporte 0.6 = 3 de 5 canastas: frecuentes pan, leche, pañal, cerveza y
    // los pares {cerveza,pañal}, {leche,pan}, {leche,pañal}, {pan,pañal}.
    // Cada par da 2 reglas y todas tienen confianza ≥ 0.75.
    const { rules } = apriori(CANASTAS, { minSupport: 0.6, minConfidence: 0.7, maxItemsetSize: 3 });

    expect(rules).toHaveLength(8);
    // {cerveza} → {pañal}: 3 canastas con ambos / 3 con cerveza = 1;
    // lift = 1 / (4/5) = 1.25.
    expect(rules[0]).toMatchObject({ antecedent: ['cerveza'], consequent: ['pañal'], count: 3 });
    expect(rules[0].support).toBeCloseTo(0.6);
    expect(rules[0].confidence).toBeCloseTo(1);
    expect(rules[0].lift).toBeCloseTo(1.25);
  });

  it('el antecedente es un conjunto de varios productos, no un texto', () => {
    // Soporte 0.4 = 2 canastas: {leche,pan,pañal} aparece en las canastas 4 y 5.
    // {leche,pan} → {pañal}: 2 / 3 canastas con leche y pan = 0.667.
    const { rules } = apriori(CANASTAS, { minSupport: 0.4, minConfidence: 0.6, maxItemsetSize: 3 });

    const regla = rules.find(
      (r) => r.antecedent.join() === 'leche,pan' && r.consequent.join() === 'pañal',
    );
    expect(regla).toBeDefined();
    expect(regla!.count).toBe(2);
    expect(regla!.confidence).toBeCloseTo(2 / 3);
  });

  it('es reproducible: las mismas canastas en otro orden dan el mismo resultado', () => {
    const params = { minSupport: 0.4, minConfidence: 0.5, maxItemsetSize: 3 };
    const reordenadas = [...CANASTAS].reverse().map((canasta) => [...canasta].reverse());

    expect(apriori(reordenadas, params)).toEqual(apriori(CANASTAS, params));
  });

  it('rechaza soporte 0 y sin canastas no inventa reglas', () => {
    expect(() => apriori(CANASTAS, { minSupport: 0, minConfidence: 0.5, maxItemsetSize: 3 })).toThrow(
      RangeError,
    );
    expect(apriori([], { minSupport: 0.5, minConfidence: 0.5, maxItemsetSize: 3 })).toEqual({
      itemsets: [],
      rules: [],
    });
  });
});
