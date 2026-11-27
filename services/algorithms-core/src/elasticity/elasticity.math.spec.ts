import { ajustarLogLog, classifyElasticity, logLogRegression, PriceQuantity, ReglasElasticidad } from './elasticity.math';

/** Las reglas de antes (3 observaciones, 2 precios): los casos de QA de 3 puntos verifican la FÓRMULA. */
const REGLAS_QA: ReglasElasticidad = { minObservaciones: 3, minPreciosDistintos: 2 };

describe('elasticity.math (trasladado de M11 sin cambios)', () => {
  it('caso A del plan de QA: 10, 11, 12 con 100, 80, 65 da E = −2.3624 y R² = 0.99997', () => {
    // Valores de la referencia de QA (scipy linregress), QA-ALG56-11.
    const resultado = logLogRegression([
      { price: 10, quantity: 100 },
      { price: 11, quantity: 80 },
      { price: 12, quantity: 65 },
    ], REGLAS_QA);

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
    ], REGLAS_QA);

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
    ], REGLAS_QA);

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
    expect(logLogRegression([{ price: 10, quantity: 100 }, { price: 11, quantity: 80 }], REGLAS_QA)).toMatchObject({
      ok: false,
      reason: 'few-observations',
    });
    expect(
      logLogRegression(
        [
          { price: 10, quantity: 100 },
          { price: 10, quantity: 90 },
          { price: 10, quantity: 80 },
        ],
        REGLAS_QA,
      ),
    ).toMatchObject({ ok: false, reason: 'single-price' });
    expect(
      logLogRegression(
        [
          { price: 0, quantity: 100 },
          { price: 11, quantity: 80 },
          { price: 12, quantity: 70 },
        ],
        REGLAS_QA,
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-values' });
  });
});

/** Puntos sobre q = 1000 · p^E (con E = −1.5 por default), un precio por punto. */
function curva(precios: number[], e = -1.5, grupo?: string): PriceQuantity[] {
  return precios.map((p) => ({ price: p, quantity: 1000 * p ** e, ...(grupo ? { group: grupo } : {}) }));
}

describe('elasticity.math: reglas de publicación (decididas en el Sprint 4)', () => {
  it('frontera de observaciones: 7 → no calculable; 8 → se publica', () => {
    const siete = curva([10, 11, 12, 10, 11, 12, 10]);
    const ocho = curva([10, 11, 12, 10, 11, 12, 10, 11]);
    expect(logLogRegression(siete)).toMatchObject({ ok: false, reason: 'few-observations', observations: 7 });
    const r = logLogRegression(ocho);
    expect(r).toMatchObject({ ok: true, observations: 8, distinctPrices: 3 });
    if (r.ok) expect(r.elasticity).toBeCloseTo(-1.5, 10);
  });

  it('frontera de precios distintos: 2 → no calculable; 3 → se publica', () => {
    expect(logLogRegression(curva([10, 11, 10, 11, 10, 11, 10, 11]))).toMatchObject({
      ok: false,
      reason: 'few-prices',
      distinctPrices: 2,
    });
    expect(logLogRegression(curva([10, 11, 12, 10, 11, 10, 11, 10]))).toMatchObject({ ok: true, distinctPrices: 3 });
  });

  it('los precios se comparan al centavo: 18.004 y 18.001 son el mismo precio', () => {
    const casi = [18.001, 18.004, 18.003, 18.002, 18.0, 18.004, 18.001, 18.003].map((p, i) => ({
      price: p,
      quantity: 10 + i,
    }));
    expect(logLogRegression(casi)).toMatchObject({ ok: false, reason: 'single-price', distinctPrices: 1 });
  });

  it('precio sin cambio → no calculable, nunca E = 0 "inelástica"', () => {
    const fijo = Array.from({ length: 10 }, (_, i) => ({ price: 25, quantity: 40 + (i % 3) }));
    expect(logLogRegression(fijo)).toMatchObject({ ok: false, reason: 'single-price' });
  });

  it('cantidad constante → no calculable, nunca E = 0 "inelástica"', () => {
    const constante = [10, 11, 12, 13, 10, 11, 12, 13].map((p) => ({ price: p, quantity: 50 }));
    expect(logLogRegression(constante)).toMatchObject({ ok: false, reason: 'constant-quantity' });
  });

  it('efectos fijos por zona: la zona que cobra más y vende más no voltea el signo (paradoja de Simpson)', () => {
    // Cada zona sigue E = −1.5, pero la zona "alta" cobra 50 % más Y vende 4 veces más (tamaño, ingreso).
    const baja = curva([10, 11, 12, 10.5], -1.5, 'baja');
    const alta = curva([15, 16.5, 18, 15.75], -1.5, 'alta').map((o) => ({ ...o, quantity: o.quantity * 4 }));
    const sinZonas = [...baja, ...alta].map(({ price, quantity }) => ({ price, quantity }));

    const juntas = ajustarLogLog(sinZonas);
    expect(juntas.elasticity).toBeGreaterThan(0); // sin separar zonas: signo al revés

    const r = logLogRegression([...baja, ...alta]);
    expect(r).toMatchObject({ ok: true, observations: 8 });
    if (r.ok) {
      expect(r.elasticity).toBeCloseTo(-1.5, 10);
      expect(r.rSquared).toBeCloseTo(1, 10);
    }
  });

  it('precios distintos entre zonas pero fijos dentro de cada una → no calculable', () => {
    const obs = [
      ...Array.from({ length: 4 }, (_, i) => ({ price: 10, quantity: 100 + i, group: 'a' })),
      ...Array.from({ length: 4 }, (_, i) => ({ price: 12, quantity: 80 + i, group: 'b' })),
      ...Array.from({ length: 4 }, (_, i) => ({ price: 14, quantity: 70 + i, group: 'c' })),
    ];
    expect(logLogRegression(obs)).toMatchObject({ ok: false, reason: 'single-price', distinctPrices: 3 });
  });

  it('con una sola zona, los efectos fijos dan exactamente la regresión de siempre', () => {
    const obs = curva([10, 11, 12, 13, 14, 10, 12, 14]).map((o, i) => ({ ...o, quantity: o.quantity * (1 + (i % 2) / 20) }));
    const conGrupo = ajustarLogLog(obs.map((o) => ({ ...o, group: 'z' })));
    const sinGrupo = ajustarLogLog(obs);
    expect(conGrupo.elasticity).toBeCloseTo(sinGrupo.elasticity, 12);
    expect(conGrupo.rSquared).toBeCloseTo(sinGrupo.rSquared!, 12);
  });
});
