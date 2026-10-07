import { calcularTotal, subtotalCentavos, totalCentavos } from './money.util';

describe('money.util — total == Σ subtotal (QA-CP-01)', () => {
  it('replica el redondeo half-up por línea de Postgres', () => {
    // (1.5 * 5.01) = 7.515 exacto. `toFixed(2)` daba "7.51" (binario),
    // Postgres materializa 7.52.
    expect(subtotalCentavos(1.5, 5.01)).toBe(752);
    expect(calcularTotal([{ cantidad: 1.5, precioUnitario: 5.01 }])).toBe('7.52');
  });

  it('el total es la suma de los subtotales redondeados, no el redondeo de la suma', () => {
    const lineas = [
      { cantidad: 1.5, precioUnitario: 5.01 }, // 7.515 → 7.52
      { cantidad: 0.5, precioUnitario: 3.01 }, // 1.505 → 1.51
      { cantidad: 2.5, precioUnitario: 1.01 }, // 2.525 → 2.53
    ];
    const suma = lineas.reduce(
      (s, l) => s + subtotalCentavos(l.cantidad, l.precioUnitario),
      0,
    );
    expect(totalCentavos(lineas)).toBe(suma);
    expect(calcularTotal(lineas)).toBe('11.56');
    // Lo que daba el cálculo anterior, para dejar la diferencia explícita.
    const viejo = lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0).toFixed(2);
    expect(viejo).toBe('11.54');
  });

  it('casos redondos quedan igual que antes', () => {
    expect(calcularTotal([{ cantidad: 2, precioUnitario: 42.5 }])).toBe('85.00');
    expect(
      calcularTotal([
        { cantidad: 2, precioUnitario: 42.5 },
        { cantidad: 1, precioUnitario: 28.5 },
      ]),
    ).toBe('113.50');
  });

  it('no acumula error de coma flotante en muchas líneas', () => {
    const lineas = Array.from({ length: 300 }, () => ({ cantidad: 1, precioUnitario: 0.1 }));
    expect(calcularTotal(lineas)).toBe('30.00');
  });

  it('sin líneas, total 0', () => {
    expect(calcularTotal([])).toBe('0.00');
  });
});
