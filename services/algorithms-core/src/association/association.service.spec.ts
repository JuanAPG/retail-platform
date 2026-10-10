import { apriori } from './apriori';
import { compararReglas, ReglaParaOrdenar } from './association.service';

const regla = (
  antecedente: string[],
  consecuente: string[],
  m: { confidence: number; lift: number | null; support: number },
): ReglaParaOrdenar => ({
  ...m,
  items: [
    ...antecedente.map((productId) => ({ productId, side: 'antecedente' as const })),
    ...consecuente.map((productId) => ({ productId, side: 'consecuente' as const })),
  ],
});
const firma = (r: ReglaParaOrdenar) =>
  ['antecedente', 'consecuente'].map((lado) => r.items.filter((i) => i.side === lado).map((i) => i.productId).sort().join('+')).join('→');

/** Todas las formas de acomodar una lista (para listas chicas). */
function permutaciones<T>(lista: T[]): T[][] {
  if (lista.length <= 1) return [lista];
  return lista.flatMap((x, i) => permutaciones([...lista.slice(0, i), ...lista.slice(i + 1)]).map((resto) => [x, ...resto]));
}

describe('compararReglas (ALG-06)', () => {
  it('reglas empatadas salen siempre en el mismo orden, sin importar cómo lleguen', () => {
    // Mismas métricas: antes el desempate era el id aleatorio de la regla.
    const m = { confidence: 0.42857, lift: 1.25, support: 0.2449 };
    const reglas = [
      regla(['leche'], ['frijol'], m),
      regla(['frijol'], ['leche'], m),
      regla(['frijol', 'queso'], ['leche'], m),
      regla(['frijol'], ['queso'], m),
    ];

    const ordenes = new Set(permutaciones(reglas).map((p) => [...p].sort(compararReglas).map(firma).join(' | ')));

    expect([...ordenes]).toEqual(['frijol→leche | frijol→queso | frijol+queso→leche | leche→frijol']);
  });

  it('ordena por confianza, luego lift (sin lift al final) y luego soporte, de mayor a menor', () => {
    const reglas = [
      regla(['a'], ['b'], { confidence: 0.5, lift: 1, support: 0.3 }),
      regla(['c'], ['d'], { confidence: 0.5, lift: null, support: 0.9 }),
      regla(['e'], ['f'], { confidence: 0.5, lift: 2, support: 0.1 }),
      regla(['g'], ['h'], { confidence: 0.5, lift: 1, support: 0.4 }),
      regla(['i'], ['j'], { confidence: 0.9, lift: 0.5, support: 0.1 }),
    ];

    expect([...reglas].sort(compararReglas).map(firma)).toEqual(['i→j', 'e→f', 'g→h', 'a→b', 'c→d']);
  });

  it('el antecedente es un conjunto: el orden de sus productos no cambia el resultado', () => {
    const m = { confidence: 0.5, lift: 1, support: 0.2 };
    expect(compararReglas(regla(['queso', 'frijol'], ['leche'], m), regla(['frijol', 'queso'], ['leche'], m))).toBe(0);
  });

  it('da el mismo orden que apriori(), así que leer de la base no lo cambia', () => {
    // Canastas con empates: a y b aparecen igual de seguido, lo mismo c y d.
    const canastas = [['a', 'b'], ['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['c', 'd'], ['a', 'b', 'c', 'd']];
    const { rules } = apriori(canastas, { minSupport: 0.1, minConfidence: 0.1, maxItemsetSize: 3 });
    const comoGuardadas = rules.map((r) =>
      regla(r.antecedent, r.consequent, { confidence: r.confidence, lift: r.lift, support: r.support }),
    );

    const releidas = [...comoGuardadas].reverse().sort(compararReglas);

    expect(releidas.map(firma)).toEqual(comoGuardadas.map(firma));
  });
});
