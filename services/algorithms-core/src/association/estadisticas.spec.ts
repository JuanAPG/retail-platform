import { apriori, estadisticasVacias } from './apriori';
import { fpGrowth } from './fpgrowth';

/**
 * Estadísticas de trabajo de Apriori y FP-Growth (ficha del algoritmo, docs/ficha-algoritmo-complejo.md).
 * Los conteos esperados se calculan a mano sobre el ejemplo de libro de apriori.spec.ts
 * (Tan, Steinbach y Kumar). Conteos: pan 4, leche 4, pañal 4, cerveza 3, refresco 2, huevo 1.
 */
const CANASTAS = [
  ['leche', 'pan'],
  ['pan', 'pañal', 'cerveza', 'huevo'],
  ['leche', 'pañal', 'cerveza', 'refresco'],
  ['pan', 'leche', 'pañal', 'cerveza'],
  ['pan', 'leche', 'pañal', 'refresco'],
];

describe('estadísticas de Apriori', () => {
  it('soporte 0.6: candidatos y frecuentes por nivel, como en el libro', () => {
    // Conteo mínimo 3. Nivel 1: 6 productos, 4 frecuentes (sin refresco ni huevo).
    // Nivel 2: los C(4,2) = 6 pares; frecuentes {cerveza,pañal}, {leche,pan}, {leche,pañal}, {pan,pañal}.
    // Nivel 3: solo {leche,pan,pañal} sale de unir dos frecuentes; está en 2 canastas: no llega.
    const e = estadisticasVacias();
    apriori(CANASTAS, { minSupport: 0.6, minConfidence: 0.5, maxItemsetSize: 3 }, e);
    expect(e).toMatchObject({ canastas: 5, productos: 6, conteoMinimo: 3 });
    expect(e.candidatosPorTamano).toEqual({ 1: 6, 2: 6, 3: 1 });
    expect(e.frecuentesPorTamano).toEqual({ 1: 4, 2: 4, 3: 0 });
    expect(e.podadosPorTamano).toEqual({ 2: 0, 3: 0 });
    // 6 pares × 5 canastas con 2+ productos, más 1 trío × 4 canastas con 3+ productos.
    expect(e.pruebasDeContencion).toBe(34);
  });

  it('soporte 0.4: la propiedad Apriori poda un candidato sin contarlo', () => {
    // Conteo mínimo 2. Frecuentes de tamaño 2: 8 de 10 (fuera {cerveza,refresco} y {pan,refresco}).
    // Al unir {leche,pan} con {leche,refresco} sale {leche,pan,refresco}, pero {pan,refresco} no es
    // frecuente: se poda. Quedan 5 tríos y 4 son frecuentes ({cerveza,leche,pan} está en 1 canasta).
    const e = estadisticasVacias();
    apriori(CANASTAS, { minSupport: 0.4, minConfidence: 0.5, maxItemsetSize: 3 }, e);
    expect(e.candidatosPorTamano).toEqual({ 1: 6, 2: 10, 3: 5 });
    expect(e.podadosPorTamano[3]).toBe(1);
    expect(e.frecuentesPorTamano).toEqual({ 1: 5, 2: 8, 3: 4 });
  });

  it('medir no cambia el resultado', () => {
    const params = { minSupport: 0.4, minConfidence: 0.6, maxItemsetSize: 3 };
    expect(apriori(CANASTAS, params, estadisticasVacias())).toEqual(apriori(CANASTAS, params));
  });
});

describe('estadísticas de FP-Growth', () => {
  it('el árbol inicial comprime las canastas: 15 productos frecuentes en 9 nodos', () => {
    // Soporte 0.6: orden por frecuencia y desempate por id = leche, pan, pañal, cerveza.
    // Caminos: leche-pan · pan-pañal-cerveza · leche-pañal-cerveza · leche-pan-pañal-cerveza ·
    // leche-pan-pañal. Comparten prefijos: 9 nodos en lugar de 2 + 3 + 3 + 4 + 3 = 15.
    const e = estadisticasVacias();
    fpGrowth(CANASTAS, { minSupport: 0.6, minConfidence: 0.5, maxItemsetSize: 3 }, e);
    expect(e).toMatchObject({ canastas: 5, productos: 6, conteoMinimo: 3, nodosArbolInicial: 9 });
    expect(e.arboles).toBeGreaterThan(1);           // el inicial más las bases condicionales
    expect(e.nodos).toBeGreaterThanOrEqual(e.nodosArbolInicial);
    expect(e.pruebasDeContencion).toBe(0);           // no genera candidatos
  });

  it('encuentra los mismos frecuentes por tamaño que Apriori', () => {
    for (const minSupport of [0.2, 0.4, 0.6]) {
      const params = { minSupport, minConfidence: 0.5, maxItemsetSize: 3 };
      const a = estadisticasVacias();
      const f = estadisticasVacias();
      apriori(CANASTAS, params, a);
      fpGrowth(CANASTAS, params, f);
      const sinCeros = (m: Record<number, number>) => Object.fromEntries(Object.entries(m).filter(([, n]) => n > 0));
      expect(sinCeros(f.frecuentesPorTamano)).toEqual(sinCeros(a.frecuentesPorTamano));
    }
  });

  it('medir no cambia el resultado', () => {
    const params = { minSupport: 0.4, minConfidence: 0.6, maxItemsetSize: 3 };
    expect(fpGrowth(CANASTAS, params, estadisticasVacias())).toEqual(fpGrowth(CANASTAS, params));
  });
});
