/**
 * Reglas puras de disponibilidad (D-38), sin base de datos ni HTTP, para
 * probarlas con los casos de control del contrato
 * (`docs/contratos/availability-service.md`).
 *
 * - Un dato de existencia vale `validDays` días (7); después está VENCIDO: no
 *   se puede afirmar ni que hay ni que falta.
 * - Un básico (producto de la canasta básica, D-03) está CUBIERTO si alguna de
 *   sus presentaciones tiene existencia vigente mayor a 0: no importa cuál
 *   presentación ni cuál marca. Otro producto no lo cubre.
 * - FALTANTE: ninguna presentación cubre y hay al menos un dato vigente.
 * - Cobertura = % de básicos cubiertos.
 */

export type EstadoExistencia = 'disponible' | 'agotado' | 'vencido';
export type EstadoBasico = 'cubierto' | 'faltante' | 'vencido' | 'sin_dato';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Vigencia por defecto de un dato (D-38). */
export const DIAS_VIGENCIA = 7;

export function diasDeVigencia(env: NodeJS.ProcessEnv = process.env): number {
  const valor = Number(env.AVAILABILITY_VALID_DAYS);
  return Number.isInteger(valor) && valor >= 1 ? valor : DIAS_VIGENCIA;
}

export interface Basico {
  productId: string;
  productName: string;
  /** Presentaciones activas del producto. */
  presentationIds: string[];
}

export interface Existencia {
  storeId: string;
  presentationId: string;
  stock: number;
  /** Cuándo se VIO el dato (no cuándo se subió). */
  capturedAt: Date;
}

/** Vigente = capturado hace `validDays` días o menos, a la hora de la consulta. */
export function estaVigente(capturedAt: Date, ahora: Date, validDays: number): boolean {
  return ahora.getTime() - capturedAt.getTime() <= validDays * MS_POR_DIA;
}

/** Días completos transcurridos desde la captura (nunca negativo). */
export function edadEnDias(capturedAt: Date, ahora: Date): number {
  return Math.max(0, Math.floor((ahora.getTime() - capturedAt.getTime()) / MS_POR_DIA));
}

export function estadoExistencia(stock: number, capturedAt: Date, ahora: Date, validDays: number): EstadoExistencia {
  if (!estaVigente(capturedAt, ahora, validDays)) return 'vencido';
  return stock > 0 ? 'disponible' : 'agotado';
}

/** `a / b` en porcentaje con 2 decimales. */
export function porcentaje(parte: number, total: number): number {
  return total === 0 ? 0 : Math.round((parte / total) * 10000) / 100;
}

export interface BasicoEnTienda {
  productId: string;
  productName: string;
  status: EstadoBasico;
  presentationsWithStock: number;
  lastCapturedAt: Date | null;
}

/** Estado de un básico en UNA tienda. `existencias` son las de esa tienda. */
export function basicoEnTienda(basico: Basico, existencias: Existencia[], ahora: Date, validDays: number): BasicoEnTienda {
  const suyas = existencias.filter((e) => basico.presentationIds.includes(e.presentationId));
  const vigentes = suyas.filter((e) => estaVigente(e.capturedAt, ahora, validDays));
  const conExistencia = vigentes.filter((e) => e.stock > 0).length;
  const status: EstadoBasico =
    conExistencia > 0 ? 'cubierto' : vigentes.length > 0 ? 'faltante' : suyas.length > 0 ? 'vencido' : 'sin_dato';
  const ultima = suyas.reduce<Date | null>(
    (reciente, e) => (reciente === null || e.capturedAt > reciente ? e.capturedAt : reciente),
    null,
  );
  return {
    productId: basico.productId,
    productName: basico.productName,
    status,
    presentationsWithStock: conExistencia,
    lastCapturedAt: ultima,
  };
}

/** Cobertura de una tienda. El orden de los campos es el del XSD. */
export interface StoreCoverage {
  storeId: string;
  validDays: number;
  basics: number;
  covered: number;
  missing: number;
  expired: number;
  noData: number;
  disponible: boolean;
  /** `null` cuando no se puede calcular: nunca 0. */
  coverage: number | null;
  motivo: string | null;
  items: BasicoEnTienda[];
}

const porNombre = (a: { productName: string }, b: { productName: string }) =>
  a.productName.localeCompare(b.productName, 'es');

export function coberturaDeTienda(
  storeId: string,
  basicos: Basico[],
  existencias: Existencia[],
  ahora: Date,
  validDays: number,
): StoreCoverage {
  const deLaTienda = existencias.filter((e) => e.storeId === storeId);
  const items = basicos.map((b) => basicoEnTienda(b, deLaTienda, ahora, validDays)).sort(porNombre);
  const contar = (estado: EstadoBasico) => items.filter((i) => i.status === estado).length;
  const covered = contar('cubierto');
  const missing = contar('faltante');

  let motivo: string | null = null;
  if (basicos.length === 0) {
    motivo = 'El catálogo no tiene productos marcados como canasta básica (D-03).';
  } else if (covered + missing === 0) {
    motivo = `La tienda no tiene ningún dato vigente (${validDays} días) de productos de la canasta básica (D-38).`;
  }
  return {
    storeId,
    validDays,
    basics: basicos.length,
    covered,
    missing,
    expired: contar('vencido'),
    noData: contar('sin_dato'),
    disponible: motivo === null,
    coverage: motivo === null ? porcentaje(covered, basicos.length) : null,
    motivo,
    items,
  };
}

export interface BasicoEnZona {
  productId: string;
  productName: string;
  status: EstadoBasico;
  /** Tiendas de la zona donde el básico está cubierto. */
  storesWithStock: number;
  /** `storesWithStock / stores × 100` (D-13: baja disponibilidad si < 50). */
  storeShare: number;
}

export interface TiendaEnZona {
  storeId: string;
  disponible: boolean;
  coverage: number | null;
  covered: number;
  missing: number;
}

/** Cobertura de una zona. El orden de los campos es el del XSD. */
export interface ZoneCoverage {
  zoneId: string;
  validDays: number;
  stores: number;
  basics: number;
  covered: number;
  disponible: boolean;
  coverage: number | null;
  motivo: string | null;
  items: BasicoEnZona[];
  byStore: TiendaEnZona[];
}

/** Lo más informativo que alguna tienda sabe del básico. */
const PRIORIDAD: EstadoBasico[] = ['cubierto', 'faltante', 'vencido', 'sin_dato'];

export function coberturaDeZona(
  zoneId: string,
  storeIds: string[],
  basicos: Basico[],
  existencias: Existencia[],
  ahora: Date,
  validDays: number,
): { cobertura: ZoneCoverage; porTienda: StoreCoverage[] } {
  const porTienda = storeIds.map((id) => coberturaDeTienda(id, basicos, existencias, ahora, validDays));
  const items = basicos
    .map((basico) => {
      const estados = porTienda.map((t) => t.items.find((i) => i.productId === basico.productId)!.status);
      const storesWithStock = estados.filter((e) => e === 'cubierto').length;
      return {
        productId: basico.productId,
        productName: basico.productName,
        status: PRIORIDAD.find((estado) => estados.includes(estado)) ?? 'sin_dato',
        storesWithStock,
        storeShare: porcentaje(storesWithStock, storeIds.length),
      };
    })
    .sort(porNombre);
  const covered = items.filter((i) => i.status === 'cubierto').length;
  const conDatoVigente = items.some((i) => i.status === 'cubierto' || i.status === 'faltante');

  let motivo: string | null = null;
  if (storeIds.length === 0) motivo = 'La zona no tiene tiendas activas.';
  else if (basicos.length === 0) motivo = 'El catálogo no tiene productos marcados como canasta básica (D-03).';
  else if (!conDatoVigente) {
    motivo = `Ninguna tienda de la zona tiene datos vigentes (${validDays} días) de productos de la canasta básica (D-38).`;
  }
  return {
    cobertura: {
      zoneId,
      validDays,
      stores: storeIds.length,
      basics: basicos.length,
      covered,
      disponible: motivo === null,
      coverage: motivo === null ? porcentaje(covered, basicos.length) : null,
      motivo,
      items,
      byStore: porTienda.map((t) => ({
        storeId: t.storeId,
        disponible: t.disponible,
        coverage: t.coverage,
        covered: t.covered,
        missing: t.missing,
      })),
    },
    porTienda,
  };
}

export interface Faltante {
  productId: string;
  productName: string;
  storeId: string;
  lastCapturedAt: Date | null;
}

/** Los básicos `faltante` de cada tienda (una fila por tienda donde falta). */
export function faltantes(porTienda: StoreCoverage[]): Faltante[] {
  return porTienda.flatMap((tienda) =>
    tienda.items
      .filter((item) => item.status === 'faltante')
      .map((item) => ({
        productId: item.productId,
        productName: item.productName,
        storeId: tienda.storeId,
        lastCapturedAt: item.lastCapturedAt,
      })),
  );
}
