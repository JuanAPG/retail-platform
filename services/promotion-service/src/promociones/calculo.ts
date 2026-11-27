/**
 * Cálculos del contrato §3 y §4 (D-39, D-06), sin efectos ni E/S: lo que se
 * prueba con el caso de control.
 *
 *  - Precio unitario = precio de compra / contenido base (MXN por unidad base).
 *  - Contenido base  = contenido × factor_base de su unidad (kg, l o pza).
 *  - Se calcula con TODOS los decimales y se redondea **solo al final**:
 *    importes y porcentajes a 2 decimales, contenidos a 3, mitad hacia arriba.
 *  - Nunca se promedian presentaciones (D-06): cada una se normaliza a su
 *    unidad base y se compara por separado.
 */

export const TIPOS_PROMOCION = ['descuento_porcentual', 'paquete', 'tamano_empaque'] as const;
export type TipoPromocion = (typeof TIPOS_PROMOCION)[number];

/** `unidades_medida.tipo` que tienen precio unitario comparable y su unidad base. */
export const UNIDAD_BASE = { masa: 'kg', volumen: 'l', pieza: 'pza' } as const;
export type TipoUnidad = keyof typeof UNIDAD_BASE;
export type UnidadBase = (typeof UNIDAD_BASE)[TipoUnidad];

export function esTipoComparable(tipo: string): tipo is TipoUnidad {
  return Object.prototype.hasOwnProperty.call(UNIDAD_BASE, tipo);
}

/**
 * Redondeo "mitad hacia arriba" a `decimales`: el .5 se aleja del cero, igual
 * que `round()` de PostgreSQL con `numeric`. Se pasa por la notación `e` para
 * no arrastrar el error binario (1.005 → 1.01, no 1.00).
 */
export function redondear(valor: number, decimales: number): number {
  if (!Number.isFinite(valor)) throw new Error(`No se puede redondear ${valor}.`);
  const signo = valor < 0 ? -1 : 1;
  const escalado = Math.round(Number(`${Math.abs(valor)}e${decimales}`));
  const resultado = signo * Number(`${escalado}e-${decimales}`);
  return resultado === 0 ? 0 : resultado; // sin "-0"
}

/** La presentación de la promoción, con su unidad (lo que da catalog al proponer). */
export interface PresentacionMedida {
  contenido: number;
  unidad: string;
  tipo: TipoUnidad;
  factor: number;
}

/** Los campos del tipo (contrato §4). */
export interface CamposPromocion {
  type: TipoPromocion;
  discountPct?: number | null;
  packQuantity?: number | null;
  packPrice?: number | null;
  promoContent?: number | null;
  /** Factor base de `promoUnit` (de `GET /v1/units`). */
  promoFactor?: number | null;
  promoPrice?: number | null;
}

/** Sin redondear: para seguir calculando. */
export interface PrecioCrudo {
  purchasePrice: number;
  items: number;
  contentBase: number;
  unitPrice: number;
}

export function contenidoBase(p: Pick<PresentacionMedida, 'contenido' | 'factor'>): number {
  return p.contenido * p.factor;
}

/** Precio unitario regular: el precio de anaquel entre el contenido base de UNA pieza de la presentación. */
export function regularCrudo(precio: number, p: PresentacionMedida): { price: number; contentBase: number; unitPrice: number } {
  const base = contenidoBase(p);
  return { price: precio, contentBase: base, unitPrice: precio / base };
}

/**
 * Precio promocional sin redondear. `null` si no se puede calcular: un
 * descuento sin precio regular (contrato §11: nunca un 0).
 */
export function promocionalCrudo(promo: CamposPromocion, p: PresentacionMedida, precioRegular: number | null): PrecioCrudo | null {
  switch (promo.type) {
    case 'descuento_porcentual': {
      if (precioRegular === null) return null;
      const compra = precioRegular * (1 - (promo.discountPct as number) / 100);
      const base = contenidoBase(p);
      return { purchasePrice: compra, items: 1, contentBase: base, unitPrice: compra / base };
    }
    case 'paquete': {
      const n = promo.packQuantity as number;
      const base = n * contenidoBase(p);
      const compra = promo.packPrice as number;
      return { purchasePrice: compra, items: n, contentBase: base, unitPrice: compra / base };
    }
    case 'tamano_empaque': {
      const base = (promo.promoContent as number) * (promo.promoFactor as number);
      const compra = promo.promoPrice as number;
      return { purchasePrice: compra, items: 1, contentBase: base, unitPrice: compra / base };
    }
  }
}

/** `savingsPct = (unitario regular − unitario promocional) / unitario regular × 100`, sin redondear. */
export function ahorroCrudo(unitarioRegular: number, unitarioPromocional: number): number {
  return ((unitarioRegular - unitarioPromocional) / unitarioRegular) * 100;
}

/** Redondeo final para la respuesta (§3): importes y % a 2, contenido a 3. */
export const importe = (x: number) => redondear(x, 2);
export const porcentaje = (x: number) => redondear(x, 2);
export const contenido = (x: number) => redondear(x, 3);

/**
 * Qué campos exige y prohíbe cada tipo (§4). Devuelve la lista de errores
 * (vacía = válido), con el nombre del campo para `details`.
 */
export const CAMPOS_DE_TIPO = {
  descuento_porcentual: { obligatorios: ['discountPct'], prohibidos: ['packQuantity', 'packPrice', 'promoContent', 'promoUnit', 'promoPrice'] },
  paquete: { obligatorios: ['packQuantity', 'packPrice'], prohibidos: ['discountPct', 'promoContent', 'promoUnit', 'promoPrice'] },
  tamano_empaque: { obligatorios: ['promoContent', 'promoUnit', 'promoPrice'], prohibidos: ['discountPct', 'packQuantity', 'packPrice'] },
} as const satisfies Record<TipoPromocion, { obligatorios: readonly string[]; prohibidos: readonly string[] }>;

export function erroresDeTipo(cuerpo: Record<string, unknown>): string[] {
  const reglas = CAMPOS_DE_TIPO[cuerpo.type as TipoPromocion];
  if (!reglas) return [];
  const presente = (campo: string) => cuerpo[campo] !== undefined && cuerpo[campo] !== null;
  return [
    ...reglas.obligatorios.filter((c) => !presente(c)).map((c) => `${c} es obligatorio en una promoción ${cuerpo.type}`),
    ...reglas.prohibidos.filter(presente).map((c) => `${c} no corresponde a una promoción ${cuerpo.type}`),
  ];
}

/** "ml (volumen) no se compara con la presentación en kg (masa)" (§6). */
export function mensajeIncompatible(promoUnit: string, tipoPromo: string, unidadPres: string, tipoPres: string): string {
  return `promoUnit: ${promoUnit} (${tipoPromo}) no se compara con la presentación en ${unidadPres} (${tipoPres})`;
}

export interface Comparable {
  disponible: boolean;
  /** Sin redondear, para ordenar. */
  unitPrice: number | null;
}

/**
 * Orden de `compare` (§12): por precio unitario ascendente; las no
 * disponibles al final. Estable: los empates conservan el orden de `ids`.
 */
export function ordenarComparacion<T extends Comparable>(filas: T[]): T[] {
  return filas
    .map((fila, i) => ({ fila, i }))
    .sort((a, b) => {
      if (a.fila.disponible !== b.fila.disponible) return a.fila.disponible ? -1 : 1;
      if (a.fila.disponible && b.fila.disponible) {
        const diferencia = (a.fila.unitPrice as number) - (b.fila.unitPrice as number);
        if (diferencia !== 0) return diferencia;
      }
      return a.i - b.i;
    })
    .map((x) => x.fila);
}
