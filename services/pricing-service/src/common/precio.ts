/** Máximo que cabe en `precios.precio` (NUMERIC(12,2)): 10 enteros y 2 decimales. Más allá, Postgres desborda (22003) y daba 500. */
export const PRECIO_MAXIMO = 9_999_999_999.99;
