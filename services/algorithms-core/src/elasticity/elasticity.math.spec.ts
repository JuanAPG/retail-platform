import { classifyElasticity, logLogRegression } from './elasticity.math';

describe('elasticity.math (trasladado de M11 sin cambios)', () => {
  it('caso A del plan de QA: 10, 11, 12 con 100, 80, 65 da E = −2.3624 y R² = 0.99997', () => {
    // Valores de la referencia de QA (scipy linregress), QA-ALG56-11.
    const resultado = logLogRegression([
      { price: 10, quantity: 100 },
      { price: 11, quantity: 80 },
      { price: 12, quantity: 65 },
    ]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(Math.abs(resultado.elasticity - -2.3624)).toBeLessThan(1e-4);
    expect(Math.abs(resultado.rSquared! - 0.99997)).toBeLessThan(1e-5);
    expect(classifyElasticity(resultado.elasticity)).toBe('elastic');
  });

  it('caso E de QA: la demanda sube con el precio (10, 11, 12 con 50, 60, 70) da E = +1.8466', () => {
    const resultado = logLogRegression([
      { price: 10, quantity: 50 },
      { price: 11, quantity: 60 },
      { price: 12, quantity: 70 },
    ]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(Math.abs(resultado.elasticity - 1.8466)).toBeLessThan(1e-4);
    expect(Math.abs(resultado.rSquared! - 0.99951)).toBeLessThan(1e-5);
    // La magnitud clasifica igual; que sea atípica lo marca el servicio.
    expect(classifyElasticity(resultado.elasticity)).toBe('elastic');
  });

  it('dos puntos 10 → 11 y 100 → 80, más un tercero sobre la misma recta: E = ln(0.8) / ln(1.1)', () => {
    // E = ln(80/100) / ln(11/10) = −2.3412. El tercer punto sigue la MISMA
    // recta (precio ×1.1, cantidad ×0.8) para cumplir el mínimo de 3
    // observaciones sin cambiar la pendiente.
    const resultado = logLogRegression([
      { price: 10, quantity: 100 },
      { price: 11, quantity: 80 },
      { price: 12.1, quantity: 64 },
    ]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    // Tolerancia acordada con QA: 1e-4 contra el valor exacto, no ±5e-4.
    const exacto = Math.log(80 / 100) / Math.log(11 / 10);
    expect(Math.abs(resultado.elasticity - exacto)).toBeLessThan(1e-4);
    expect(resultado.rSquared).toBeCloseTo(1, 6);
    expect(classifyElasticity(resultado.elasticity)).toBe('elastic');
  });

  it('clasifica con los límites de D-18 (unitaria entre 0.95 y 1.05, igual que la columna de la base)', () => {
    // Caso F de QA: 0.94 / 0.95 / 1.00 / 1.05 / 1.06.
    expect(classifyElasticity(-0.94)).toBe('inelastic');
    expect(classifyElasticity(-1)).toBe('unitary');
    expect(classifyElasticity(-1.06)).toBe('elastic');
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
