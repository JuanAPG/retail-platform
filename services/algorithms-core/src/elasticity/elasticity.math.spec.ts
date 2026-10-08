import { classifyElasticity, logLogRegression } from './elasticity.math';

describe('elasticity.math (trasladado de M11 sin cambios)', () => {
  it('caso de QA: precio 10 → 11 con cantidad 100 → 80 da E = −2.341 (D-01, modelo log-log)', () => {
    // E = ln(80/100) / ln(11/10) = −2.3412. Se agrega un tercer punto sobre
    // la MISMA recta (precio ×1.1, cantidad ×0.8) para cumplir el mínimo
    // de 3 observaciones sin cambiar la pendiente.
    const resultado = logLogRegression([
      { price: 10, quantity: 100 },
      { price: 11, quantity: 80 },
      { price: 12.1, quantity: 64 },
    ]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.elasticity).toBeCloseTo(-2.341, 3);
    expect(resultado.rSquared).toBeCloseTo(1, 6);
    expect(classifyElasticity(resultado.elasticity)).toBe('elastic');
  });

  it('clasifica con los límites de D-18 (unitaria entre 0.95 y 1.05, igual que la columna de la base)', () => {
    expect(classifyElasticity(-1.0501)).toBe('elastic');
    expect(classifyElasticity(-1.05)).toBe('unitary');
    expect(classifyElasticity(-0.95)).toBe('unitary');
    expect(classifyElasticity(-0.9499)).toBe('inelastic');
    // La base guarda numeric(10,4): 1.05004 se guarda como 1.0500 → unitaria.
    expect(classifyElasticity(-1.05004)).toBe('unitary');
  });

  it('sin datos suficientes devuelve el motivo en lugar de un número', () => {
    expect(logLogRegression([{ price: 10, quantity: 100 }, { price: 11, quantity: 80 }])).toMatchObject({
      ok: false,
      reason: 'few-observations',
    });
    expect(
      logLogRegression([
        { price: 10, quantity: 100 },
        { price: 10, quantity: 90 },
        { price: 10, quantity: 80 },
      ]),
    ).toMatchObject({ ok: false, reason: 'single-price' });
    expect(
      logLogRegression([
        { price: 0, quantity: 100 },
        { price: 11, quantity: 80 },
        { price: 12, quantity: 70 },
      ]),
    ).toMatchObject({ ok: false, reason: 'invalid-values' });
  });

  it('cantidad constante: E = 0 y R² nulo, nunca NaN', () => {
    const resultado = logLogRegression([
      { price: 10, quantity: 50 },
      { price: 11, quantity: 50 },
      { price: 12, quantity: 50 },
    ]);

    expect(resultado).toMatchObject({ ok: true, elasticity: 0, rSquared: null });
  });
});
