import { conflictoDeTransicion, diasInclusivos, Evaluacion, redondear, revisarEvaluacion, Transicion, variacionPct, ESTADOS, Estado } from './reglas';

describe('Casos de control §8: variationPct = (after − before) / before × 100', () => {
  it('ventas_unidades 1,000 → 1,150 = 15.00', () => {
    expect(variacionPct(1000, 1150)).toBe(15);
  });

  it('precio_unitario 27.50 → 25.00 = −9.09', () => {
    expect(variacionPct(27.5, 25)).toBe(-9.09);
  });

  it('base 0 → no hay variación: la evaluación responde 400 (y la fórmula nunca da Infinity ni NaN)', () => {
    const ev = evaluacion({ before: { from: '2026-10-02', to: '2026-10-31', value: 0 }, after: { from: '2026-11-01', to: '2026-11-30', value: 10 } });
    expect(revisarEvaluacion(ev, IMPLEMENTADA, HOY).errores).toContain('before.value debe ser mayor a 0: sin base no hay variación definida');
    expect(() => variacionPct(0, 10)).toThrow();
  });

  it('after = 0 en ventas: −100.00 (válido)', () => {
    expect(variacionPct(80, 0)).toBe(-100);
  });

  it('el redondeo es SOLO al final: 1 → 1.0005 da 0.05 (no 0.00 por redondear antes)', () => {
    expect(variacionPct(1, 1.0005)).toBe(0.05);
  });
});

describe('redondeo a 2 decimales, mitad hacia arriba (lejos del cero), sin error binario', () => {
  it.each([
    [-9.090909, -9.09],
    [1.005, 1.01],
    [2.675, 2.68],
    [-2.675, -2.68],
    [15.0000001, 15],
    [-0.004, 0],
  ])('%p → %p', (x, y) => expect(redondear(x, 2)).toBe(y));

  it('no deja -0 ni acepta valores no finitos', () => {
    expect(Object.is(redondear(-0.001, 2), 0)).toBe(true);
    expect(() => redondear(Infinity, 2)).toThrow();
  });
});

const IMPLEMENTADA = '2026-11-01';
const HOY = '2026-12-01';

function evaluacion(parcial: Partial<Evaluacion> = {}): Evaluacion {
  return {
    metric: 'precio_unitario',
    unit: 'MXN/kg',
    scope: { zoneId: 'f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44', presentationId: '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e' },
    before: { from: '2026-10-02', to: '2026-10-31', value: 27.5 },
    after: { from: '2026-11-01', to: '2026-11-30', value: 25 },
    ...parcial,
  };
}

describe('unidades por métrica (§8)', () => {
  it.each([
    ['ventas_unidades', 'pza'],
    ['ventas_importe', 'MXN'],
    ['precio_unitario', 'MXN/kg'],
    ['precio_unitario', 'MXN/l'],
    ['precio_unitario', 'MXN/pza'],
  ] as const)('%s con %s: válida', (metric, unit) => {
    expect(revisarEvaluacion(evaluacion({ metric, unit }), IMPLEMENTADA, HOY).incompatibles).toEqual([]);
  });

  it.each([
    ['precio_unitario', 'MXN', 'unit MXN no corresponde a la métrica precio_unitario (usa MXN/kg, MXN/l o MXN/pza)'],
    ['precio_unitario', 'pza', 'unit pza no corresponde a la métrica precio_unitario (usa MXN/kg, MXN/l o MXN/pza)'],
    ['ventas_unidades', 'MXN', 'unit MXN no corresponde a la métrica ventas_unidades (usa pza)'],
    ['ventas_importe', 'MXN/kg', 'unit MXN/kg no corresponde a la métrica ventas_importe (usa MXN)'],
  ] as const)('%s con %s → incompatible', (metric, unit, mensaje) => {
    expect(revisarEvaluacion(evaluacion({ metric, unit }), IMPLEMENTADA, HOY).incompatibles).toEqual([mensaje]);
  });
});

describe('alcance y periodos (§8)', () => {
  const errores = (p: Partial<Evaluacion>) => revisarEvaluacion(evaluacion(p), IMPLEMENTADA, HOY).errores;

  it('el ejemplo del contrato es válido (30 días antes y 30 después)', () => {
    expect(errores({})).toEqual([]);
    expect(diasInclusivos('2026-10-02', '2026-10-31')).toBe(30);
    expect(diasInclusivos('2026-11-01', '2026-11-30')).toBe(30);
  });

  it('scope vacío → 400; precio_unitario sin presentationId → 400; ventas sin presentationId sí', () => {
    expect(errores({ scope: {} })).toContain('scope debe traer al menos uno de zoneId, storeId o presentationId');
    expect(errores({ scope: { zoneId: 'z' } })).toEqual(['precio_unitario exige scope.presentationId (D-06: nunca se mezclan presentaciones)']);
    expect(errores({ metric: 'ventas_unidades', unit: 'pza', scope: { zoneId: 'z' } })).toEqual([]);
  });

  it('from > to en un periodo → 400', () => {
    expect(errores({ before: { from: '2026-10-31', to: '2026-10-02', value: 27.5 } })).toContain('before.from no puede ser posterior a before.to');
    expect(errores({ after: { from: '2026-11-30', to: '2026-11-01', value: 25 } })).toContain('after.from no puede ser posterior a after.to');
  });

  it('before.to debe ser ANTERIOR al día de implementación (el mismo día no cuenta)', () => {
    const r = errores({ before: { from: '2026-10-03', to: '2026-11-01', value: 27.5 } });
    expect(r).toContain('before.to debe ser anterior al día de implementación (2026-11-01)');
  });

  it('after.from puede ser el día de implementación, pero no antes', () => {
    expect(errores({ before: { from: '2026-10-01', to: '2026-10-30', value: 27.5 }, after: { from: '2026-10-31', to: '2026-11-29', value: 25 } })).toContain(
      'after.from no puede ser anterior al día de implementación (2026-11-01)',
    );
  });

  it('after en el futuro → 400 (hoy sí se permite)', () => {
    expect(revisarEvaluacion(evaluacion(), IMPLEMENTADA, '2026-11-30').errores).toEqual([]);
    expect(revisarEvaluacion(evaluacion(), IMPLEMENTADA, '2026-11-29').errores).toEqual(['after.to no puede ser futuro (hoy es 2026-11-29)']);
  });

  it('periodos de distinta duración → 400 (PROPUESTA del contrato)', () => {
    expect(errores({ after: { from: '2026-11-01', to: '2026-11-29', value: 25 } })).toEqual(['before y after deben durar lo mismo (30 días contra 29)']);
  });

  it('fechas inexistentes → 400', () => {
    expect(errores({ after: { from: '2026-11-01', to: '2026-11-31', value: 25 } })).toEqual(['after.from y after.to deben ser fechas YYYY-MM-DD válidas']);
  });

  it('after.value = 0: válido en ventas, 400 en precio_unitario', () => {
    expect(errores({ after: { from: '2026-11-01', to: '2026-11-30', value: 0 } })).toContain('after.value debe ser mayor a 0 en precio_unitario');
    expect(errores({ metric: 'ventas_unidades', unit: 'pza', after: { from: '2026-11-01', to: '2026-11-30', value: 0 } })).toEqual([]);
  });
});

describe('estados (§4): solo hacia adelante y de uno en uno', () => {
  const transiciones: Transicion[] = ['en_implementacion', 'implementada', 'evaluada'];
  const desde: Record<Transicion, Estado> = { en_implementacion: 'asignada', implementada: 'en_implementacion', evaluada: 'implementada' };

  it.each(transiciones)('%s procede solo desde su estado anterior', (t) => {
    for (const actual of ESTADOS) {
      expect(conflictoDeTransicion(actual, t) === null).toBe(actual === desde[t]);
    }
  });

  it.each([
    ['asignada', 'implementada', 'Transición fuera de orden.', ['estado actual: asignada', 'transición pedida: implementada', 'primero se inicia (start)']],
    ['en_implementacion', 'evaluada', 'Transición fuera de orden.', ['estado actual: en_implementacion', 'transición pedida: evaluada', 'falta marcarla implementada']],
    ['asignada', 'evaluada', 'Transición fuera de orden.', ['estado actual: asignada', 'transición pedida: evaluada', 'primero se inicia (start) y luego se marca implementada']],
  ] as const)('salto: %s → %s = 409 con los details del contrato', (actual, pedida, message, details) => {
    expect(conflictoDeTransicion(actual, pedida)).toEqual({ message, details });
  });

  it.each([
    ['en_implementacion', 'en_implementacion', 'ya se inició (start)'],
    ['implementada', 'en_implementacion', 'ya se inició (start)'],
    ['evaluada', 'en_implementacion', 'ya se inició (start)'],
    ['implementada', 'implementada', 'ya se marcó implementada'],
    ['evaluada', 'implementada', 'ya se marcó implementada'],
    ['evaluada', 'evaluada', 'ya se evaluó'],
  ] as const)('repetida: estando %s, pedir %s = 409 (%s)', (actual, pedida, pista) => {
    expect(conflictoDeTransicion(actual, pedida)).toEqual({
      message: 'Transición repetida: el seguimiento ya pasó por ese estado.',
      details: [`estado actual: ${actual}`, `transición pedida: ${pedida}`, pista],
    });
  });
});
