/**
 * Aritmética de dinero de M06 — NO calcular totales con `+` y `toFixed`.
 *
 * `transacciones_detalle.subtotal` es una columna GENERATED de Postgres
 * (`cantidad * precio_unitario` sobre NUMERIC(10,2) y NUMERIC(12,2)), así
 * que Postgres redondea **cada línea** a 2 decimales con half-up. Sumar en
 * coma flotante y redondear una sola vez al final da un resultado distinto
 * en dos casos reales:
 *
 *  - medio centavo: `(1.5 * 5.01).toFixed(2)` → "7.51", Postgres → 7.52;
 *  - escala: 0.333 se guarda como 0.33, pero el total ya usó 0.333.
 *
 * Aquí se replica exactamente lo que hará la base: se trabaja en centavos
 * enteros, de modo que `total` siempre es igual a Σ `subtotal`. La escala
 * de entrada la limitan los DTOs (`maxDecimalPlaces: 2`).
 */

/** Centavos de un valor con 2 decimales como máximo. */
function aCentavos(valor: number): number {
  return Math.round(valor * 100);
}

/**
 * Subtotal de una línea en centavos, con el mismo redondeo half-up que
 * aplica Postgres al materializar la columna GENERATED.
 */
export function subtotalCentavos(cantidad: number, precioUnitario: number): number {
  // cantidad y precio en centavos → el producto queda en 1e-4; se baja a
  // centavos redondeando half-up (ambos factores son positivos).
  const producto = aCentavos(cantidad) * aCentavos(precioUnitario);
  return Math.floor((producto + 50) / 100);
}

/** Total de la transacción en centavos: Σ de los subtotales ya redondeados. */
export function totalCentavos(
  lineas: { cantidad: number; precioUnitario: number }[],
): number {
  return lineas.reduce((suma, l) => suma + subtotalCentavos(l.cantidad, l.precioUnitario), 0);
}

/** Centavos → el string NUMERIC(14,2) que espera la columna `total`. */
export function centavosAImporte(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/**
 * Total de la transacción como importe, consistente con Σ `subtotal`.
 * Es la única forma permitida de calcular `transacciones.total`.
 */
export function calcularTotal(lineas: { cantidad: number; precioUnitario: number }[]): string {
  return centavosAImporte(totalCentavos(lineas));
}
