import { apriori } from './apriori';
import { fpGrowth, itemOrder } from './fpgrowth';

/** El ejemplo de libro de apriori.spec.ts (Tan, Steinbach y Kumar). */
const CANASTAS = [
  ['leche', 'pan'],
  ['pan', 'pañal', 'cerveza', 'huevo'],
  ['leche', 'pañal', 'cerveza', 'refresco'],
  ['pan', 'leche', 'pañal', 'cerveza'],
  ['pan', 'leche', 'pañal', 'refresco'],
];

/** Números al azar con semilla (mulberry32): las mismas canastas cada vez que corre la prueba. */
function conSemilla(semilla: number) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fpGrowth (RF-14: mismas reglas que Apriori con los mismos datos)', () => {
  it('ejemplo de libro: el mismo resultado que Apriori, itemsets y reglas en el mismo orden', () => {
    for (const minSupport of [0.2, 0.4, 0.6]) {
      for (const minConfidence of [0.1, 0.6, 1]) {
        const params = { minSupport, minConfidence, maxItemsetSize: 4 };
        expect(fpGrowth(CANASTAS, params)).toEqual(apriori(CANASTAS, params));
      }
    }
    // No en vacío: con soporte 0.6 y confianza 0.7 son las 8 reglas del libro.
    expect(fpGrowth(CANASTAS, { minSupport: 0.6, minConfidence: 0.7, maxItemsetSize: 3 }).rules).toHaveLength(8);
  });

  it('caso de QA: {leche, pan} → {café} sale con soporte 0.30 y no con 0.31', () => {
    // 10 canastas: 3 con leche, pan y café (soporte 0.30) de 5 con leche y
    // pan (confianza 0.6); café está en 5 (lift 0.6 / 0.5 = 1.2).
    const canastas = [
      ...Array.from({ length: 3 }, () => ['leche', 'pan', 'café']),
      ...Array.from({ length: 2 }, () => ['leche', 'pan']),
      ...Array.from({ length: 2 }, () => ['café']),
      ...Array.from({ length: 3 }, () => ['huevo']),
    ];
    const regla = (minSupport: number) => {
      const params = { minSupport, minConfidence: 0.5, maxItemsetSize: 3 };
      const resultado = fpGrowth(canastas, params);
      expect(resultado).toEqual(apriori(canastas, params));
      return resultado.rules.find((r) => r.antecedent.join() === 'leche,pan' && r.consequent.join() === 'café');
    };

    expect(regla(0.3)).toMatchObject({ support: 0.3, confidence: 0.6, count: 3 });
    expect(regla(0.3)!.lift).toBeCloseTo(1.2);
    expect(regla(0.31)).toBeUndefined();
  });

  it('300 casos de canastas al azar: siempre el mismo resultado que Apriori', () => {
    const azar = conSemilla(2026);
    const entre = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
    let reglas = 0;
    let deTresOMas = 0;

    for (let caso = 0; caso < 300; caso++) {
      // Ids donde el orden de texto no es el numérico ('p10' < 'p2'), y
      // productos repetidos dentro de una canasta.
      const productos = Array.from({ length: entre(2, 12) }, (_, n) => `p${n + 1}`);
      const canastas = Array.from({ length: entre(1, 60) }, () =>
        Array.from({ length: entre(1, 6) }, () => productos[entre(0, productos.length - 1)]),
      );
      const params = {
        minSupport: [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 1][entre(0, 6)],
        minConfidence: [0.01, 0.2, 0.5, 0.8, 1][entre(0, 4)],
        maxItemsetSize: entre(1, 5),
      };
      const esperado = apriori(canastas, params);

      expect(fpGrowth(canastas, params)).toEqual(esperado);
      reglas += esperado.rules.length;
      deTresOMas += esperado.itemsets.filter((itemset) => itemset.items.length >= 3).length;
    }

    // No pasa en vacío: hubo muchas reglas e itemsets de 3 o más productos.
    expect(reglas).toBeGreaterThan(1000);
    expect(deTresOMas).toBeGreaterThan(100);
  });

  it('es reproducible: las mismas canastas en otro orden dan el mismo resultado', () => {
    const params = { minSupport: 0.4, minConfidence: 0.5, maxItemsetSize: 3 };
    const reordenadas = [...CANASTAS].reverse().map((canasta) => [...canasta].reverse());

    expect(fpGrowth(reordenadas, params)).toEqual(fpGrowth(CANASTAS, params));
  });

  it('el árbol ordena por frecuencia y desempata por id', () => {
    const conteos = new Map([
      ['p2', 3],
      ['p10', 3],
      ['p1', 5],
      ['p3', 1],
    ]);

    expect(itemOrder(conteos, 2)).toEqual(['p1', 'p10', 'p2']);
  });

  it('mismos umbrales que Apriori (D-17), y sin canastas no inventa reglas', () => {
    const correr = (minSupport: number, minConfidence: number) => () =>
      fpGrowth(CANASTAS, { minSupport, minConfidence, maxItemsetSize: 3 });

    expect(correr(1, 1)).not.toThrow();
    expect(correr(0, 0.5)).toThrow(RangeError);
    expect(correr(1.01, 0.5)).toThrow(RangeError);
    expect(correr(0.5, 0)).toThrow(RangeError);
    expect(correr(0.5, 1.01)).toThrow(RangeError);
    expect(fpGrowth([], { minSupport: 0.5, minConfidence: 0.5, maxItemsetSize: 3 })).toEqual({
      itemsets: [],
      rules: [],
    });
  });
});
