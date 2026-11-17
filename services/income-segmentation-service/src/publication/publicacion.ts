/**
 * D-36 (anonimización): un agregado de una combinación zona-segmento con
 * pocos datos describe a una sola tienda o a unas cuantas compras, así que no
 * se publica: sale `disponible: false` con su motivo, NUNCA un número.
 *
 * Función pura para poder probarla con los casos de control del contrato.
 */

export type ReglaPublicacion = 'ambos' | 'cualquiera';

export interface UmbralesPublicacion {
  minTransacciones: number;
  minTiendas: number;
  /**
   * P-11 PENDIENTE: D-36 dice "menos de 10 transacciones (o 3 tiendas)" y no
   * fija qué pasa cuando solo se cumple un umbral.
   *  - `ambos` (por defecto): hacen falta los dos. En la duda NO publica.
   *  - `cualquiera`: basta uno.
   * Los dos casos sin duda (se cumplen los dos / no se cumple ninguno) dan lo
   * mismo con cualquiera de las dos lecturas.
   */
  regla: ReglaPublicacion;
}

export interface Publicable {
  disponible: boolean;
  motivo: string | null;
}

export const UMBRALES_D36: UmbralesPublicacion = { minTransacciones: 10, minTiendas: 3, regla: 'ambos' };

/** Lee los umbrales del entorno; un valor inválido cae al de D-36. */
export function umbralesDelEntorno(env: NodeJS.ProcessEnv = process.env): UmbralesPublicacion {
  const entero = (texto: string | undefined, porDefecto: number) => {
    const valor = Number(texto);
    return Number.isInteger(valor) && valor >= 1 ? valor : porDefecto;
  };
  return {
    minTransacciones: entero(env.PUBLICATION_MIN_TRANSACTIONS, UMBRALES_D36.minTransacciones),
    minTiendas: entero(env.PUBLICATION_MIN_STORES, UMBRALES_D36.minTiendas),
    regla: env.PUBLICATION_RULE === 'cualquiera' ? 'cualquiera' : 'ambos',
  };
}

export function evaluarPublicacion(
  transacciones: number,
  tiendas: number,
  umbrales: UmbralesPublicacion = UMBRALES_D36,
): Publicable {
  const { minTransacciones, minTiendas, regla } = umbrales;
  const bastanTransacciones = transacciones >= minTransacciones;
  const bastanTiendas = tiendas >= minTiendas;

  if (bastanTransacciones && bastanTiendas) return { disponible: true, motivo: null };

  if (!bastanTransacciones && !bastanTiendas) {
    return {
      disponible: false,
      motivo: `Menos de ${minTransacciones} transacciones y menos de ${minTiendas} tiendas en la combinación zona-segmento (D-36).`,
    };
  }

  // Solo se cumple uno: es justo el caso que P-11 no ha decidido.
  if (regla === 'cualquiera') return { disponible: true, motivo: null };
  return {
    disponible: false,
    motivo: bastanTransacciones
      ? `Menos de ${minTiendas} tiendas en la combinación zona-segmento (D-36).`
      : `Menos de ${minTransacciones} transacciones en la combinación zona-segmento (D-36).`,
  };
}
