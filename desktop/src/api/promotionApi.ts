import { ApiError, pedir } from './httpClient';
import { asList, bool, num, numberOrNull, text, textOrNull } from './xml';

/*
 * promotion-service (3115, D-39). Contrato: docs/contratos/promotion-service.md / .xsd, namespace
 * promotion/v1. Acepta cuerpos XML: el rechazo va como <rechazoPromocionRequest>.
 *
 * Desde el escritorio:
 *  - Los 3 perfiles leen (lista, detalle, precio unitario y comparación).
 *  - Solo el Responsable de precios aprueba o rechaza (ACCIONES.resolverPromociones).
 *  - Nadie propone: proponer es del Gerente de categoría, que no entra al escritorio (D-31).
 */

export const TIPOS_PROMOCION = ['descuento_porcentual', 'paquete', 'tamano_empaque'] as const;
export const ESTADOS_PROMOCION = ['pendiente', 'aprobada', 'rechazada'] as const;

export const NOMBRE_TIPO: Record<string, string> = {
  descuento_porcentual: 'Descuento porcentual',
  paquete: 'Paquete (n por $)',
  tamano_empaque: 'Tamaño de empaque',
};

export const NOMBRE_ESTADO: Record<string, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
};

export const NOMBRE_VIGENCIA: Record<string, string> = {
  programada: 'Programada',
  vigente: 'Vigente',
  vencida: 'Vencida',
};

export interface Promocion {
  id: string;
  name: string;
  type: string;
  productId: string;
  presentationId: string;
  storeId: string | null;
  zoneId: string | null;
  discountPct: number | null;
  packQuantity: number | null;
  packPrice: number | null;
  promoContent: number | null;
  promoUnit: string | null;
  promoPrice: number | null;
  currency: string;
  validFrom: string;
  validTo: string;
  status: string;
  /** programada | vigente | vencida. Null en `rechazada`. */
  validity: string | null;
  proposedBy: string;
  proposedAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  rejectionReason: string | null;
}

export interface PrecioUnitario {
  promotionId: string;
  type: string;
  status: string;
  storeId: string;
  baseUnit: string;
  currency: string;
  disponible: boolean;
  motivo: string | null;
  regular: {
    disponible: boolean;
    price: number | null;
    effectiveDate: string | null;
    contentBase: number | null;
    unitPrice: number | null;
    motivo: string | null;
  };
  /** Null si no se pudo calcular (nunca 0). */
  promotional: { purchasePrice: number; items: number; contentBase: number; unitPrice: number } | null;
  savingsPct: number | null;
}

export interface FilaComparacion {
  promotionId: string;
  type: string;
  presentationId: string;
  status: string;
  disponible: boolean;
  unitPrice: number | null;
  regularUnitPrice: number | null;
  savingsPct: number | null;
  motivo: string | null;
}

export interface ComparacionPromociones {
  productId: string;
  storeId: string;
  baseUnit: string;
  currency: string;
  filas: FilaComparacion[];
}

export function parsePromocion(p: any): Promocion {
  return {
    id: text(p?.id),
    name: text(p?.name),
    type: text(p?.type),
    productId: text(p?.productId),
    presentationId: text(p?.presentationId),
    storeId: textOrNull(p?.storeId),
    zoneId: textOrNull(p?.zoneId),
    discountPct: numberOrNull(p?.discountPct),
    packQuantity: numberOrNull(p?.packQuantity),
    packPrice: numberOrNull(p?.packPrice),
    promoContent: numberOrNull(p?.promoContent),
    promoUnit: textOrNull(p?.promoUnit),
    promoPrice: numberOrNull(p?.promoPrice),
    currency: text(p?.currency) || 'MXN',
    validFrom: text(p?.validFrom),
    validTo: text(p?.validTo),
    status: text(p?.status),
    validity: textOrNull(p?.validity),
    proposedBy: text(p?.proposedBy),
    proposedAt: text(p?.proposedAt),
    resolvedBy: textOrNull(p?.resolvedBy),
    resolvedAt: textOrNull(p?.resolvedAt),
    rejectionReason: textOrNull(p?.rejectionReason),
  };
}

/** <promocionListResponse> */
export function parsePromociones(r: any): { promociones: Promocion[]; total: number } {
  return { promociones: asList(r?.data?.item).map(parsePromocion), total: Number(r?.total ?? 0) };
}

/** <precioUnitarioResponse> */
export function parsePrecioUnitario(r: any): PrecioUnitario {
  const reg = r?.regular ?? {};
  const promo = r?.promotional;
  return {
    promotionId: text(r?.promotionId),
    type: text(r?.type),
    status: text(r?.status),
    storeId: text(r?.storeId),
    baseUnit: text(r?.baseUnit),
    currency: text(r?.currency) || 'MXN',
    disponible: bool(r?.disponible),
    motivo: textOrNull(r?.motivo),
    regular: {
      disponible: bool(reg.disponible),
      price: numberOrNull(reg.price),
      effectiveDate: textOrNull(reg.effectiveDate),
      contentBase: numberOrNull(reg.contentBase),
      unitPrice: numberOrNull(reg.unitPrice),
      motivo: textOrNull(reg.motivo),
    },
    promotional:
      promo && typeof promo === 'object'
        ? {
            purchasePrice: num(promo.purchasePrice),
            items: num(promo.items),
            contentBase: num(promo.contentBase),
            unitPrice: num(promo.unitPrice),
          }
        : null,
    savingsPct: numberOrNull(r?.savingsPct),
  };
}

/**
 * Orden de la comparación: de la más barata por unidad a la más cara; las no disponibles (sin
 * precio unitario) al final. El servicio ya las manda así; se reordena por si acaso.
 */
export function ordenarComparacion(filas: FilaComparacion[]): FilaComparacion[] {
  return [...filas].sort((a, b) => {
    const pa = a.disponible && a.unitPrice !== null ? a.unitPrice : Number.POSITIVE_INFINITY;
    const pb = b.disponible && b.unitPrice !== null ? b.unitPrice : Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}

/** <comparacionPromocionesResponse> */
export function parseComparacion(r: any): ComparacionPromociones {
  return {
    productId: text(r?.productId),
    storeId: text(r?.storeId),
    baseUnit: text(r?.baseUnit),
    currency: text(r?.currency) || 'MXN',
    filas: ordenarComparacion(
      asList(r?.data?.item).map((f: any) => ({
        promotionId: text(f.promotionId),
        type: text(f.type),
        presentationId: text(f.presentationId),
        status: text(f.status),
        disponible: bool(f.disponible),
        unitPrice: numberOrNull(f.unitPrice),
        regularUnitPrice: numberOrNull(f.regularUnitPrice),
        savingsPct: numberOrNull(f.savingsPct),
        motivo: textOrNull(f.motivo),
      })),
    ),
  };
}

const MXN = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const cantidad = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 3 });

/** Los campos que definen la promoción según su tipo, en palabras ("3 por $80.00"). */
export function camposDelTipo(p: Promocion): string {
  switch (p.type) {
    case 'descuento_porcentual':
      return p.discountPct === null ? '—' : `${cantidad(p.discountPct)} % de descuento`;
    case 'paquete':
      return p.packQuantity === null || p.packPrice === null ? '—' : `${p.packQuantity} por ${MXN(p.packPrice)}`;
    case 'tamano_empaque':
      return p.promoContent === null || p.promoPrice === null
        ? '—'
        : `${cantidad(p.promoContent)} ${p.promoUnit ?? ''} por ${MXN(p.promoPrice)}`.replace('  ', ' ');
    default:
      return '—';
  }
}

/** ¿Se pueden comparar? De 2 a 10, todas del mismo producto (contrato §12). Devuelve el motivo o null. */
export function motivoNoComparable(promociones: Promocion[]): string | null {
  if (promociones.length < 2) return 'Elige al menos 2 promociones.';
  if (promociones.length > 10) return 'Se comparan como máximo 10 promociones.';
  const producto = promociones[0].productId;
  if (promociones.some((p) => p.productId !== producto)) return 'Solo se comparan promociones del mismo producto.';
  return null;
}

/**
 * Texto claro para un 409 de aprobar o rechazar (contrato §9 y §10): ya resuelta por alguien más,
 * o ya vencida. Otro error se muestra tal cual.
 */
export function mensajeConflictoPromocion(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const texto = `${e.message} ${e.details.join(' ')}`.toLowerCase();
  if (/venci|vigencia|terminó/.test(texto)) {
    return `Ya vencida: ${e.message} Ya no se puede aprobar; si sigue pendiente, recházala para limpiar la bandeja.`;
  }
  return `Ya resuelta: ${e.message} Otro revisor la aprobó o rechazó antes. La bandeja se actualizó.`;
}

export interface FiltrosPromocion {
  status?: string;
  type?: string;
  zoneId?: string;
  storeId?: string;
  productId?: string;
  /** YYYY-MM-DD: aprobadas vigentes ese día. */
  activeOn?: string;
}

function sinVacios(f: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/** GET /v1/promotions. Con status=pendiente el servicio la entrega como cola: la más antigua primero. */
export async function listarPromociones(filtros: FiltrosPromocion = {}, page = 1, limit = 100) {
  return parsePromociones(
    await pedir({
      servicio: 'promotion',
      ruta: 'v1/promotions',
      params: sinVacios({ ...filtros, page, limit }),
      raiz: 'promocionListResponse',
    }),
  );
}

/** Bandeja del Responsable de precios: las pendientes, la más antigua primero. */
export async function bandejaPendientes() {
  return listarPromociones({ status: 'pendiente' });
}

export async function obtenerPromocion(id: string): Promise<Promocion> {
  return parsePromocion(await pedir({ servicio: 'promotion', ruta: `v1/promotions/${id}`, raiz: 'promocionResponse' }));
}

/** PATCH /:id/approve, sin cuerpo. Solo el Responsable de precios. */
export async function aprobarPromocion(id: string): Promise<Promocion> {
  return parsePromocion(
    await pedir({ servicio: 'promotion', metodo: 'PATCH', ruta: `v1/promotions/${id}/approve`, raiz: 'promocionResponse' }),
  );
}

export const MOTIVO_MIN = 10;
export const MOTIVO_MAX = 500;

/** Cuerpo de <rechazoPromocionRequest> (XSD: reason de 10 a 500 caracteres). */
export function cuerpoRechazo(reason: string): Record<string, unknown> {
  return { reason: reason.trim() };
}

/** PATCH /:id/reject con cuerpo XML <rechazoPromocionRequest>. Solo el Responsable de precios. */
export async function rechazarPromocion(id: string, reason: string): Promise<Promocion> {
  return parsePromocion(
    await pedir({
      servicio: 'promotion',
      metodo: 'PATCH',
      ruta: `v1/promotions/${id}/reject`,
      xml: { raiz: 'rechazoPromocionRequest', datos: cuerpoRechazo(reason) },
      raiz: 'promocionResponse',
    }),
  );
}

/** GET /:id/unit-price?storeId= (storeId obligatorio si la promoción es por zona). */
export async function precioUnitario(id: string, storeId?: string): Promise<PrecioUnitario> {
  return parsePrecioUnitario(
    await pedir({
      servicio: 'promotion',
      ruta: `v1/promotions/${id}/unit-price`,
      params: storeId ? { storeId } : undefined,
      raiz: 'precioUnitarioResponse',
    }),
  );
}

/** GET /compare?ids=a,b,c&storeId= (2 a 10 del mismo producto). */
export async function compararPromociones(ids: string[], storeId: string): Promise<ComparacionPromociones> {
  return parseComparacion(
    await pedir({
      servicio: 'promotion',
      ruta: 'v1/promotions/compare',
      params: { ids: ids.join(','), storeId },
      raiz: 'comparacionPromocionesResponse',
    }),
  );
}
