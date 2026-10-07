import { Basket } from '../entities/basket.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionDetail } from '../entities/transaction-detail.entity';

/**
 * Forma de las respuestas de M06/M07 — ES EL CONTRATO, no un detalle de
 * implementación.
 *
 * Las entidades NO se devuelven crudas. `Transaction.store` y
 * `Basket.zone` son relaciones `eager`, y las entidades de catálogo traen
 * las suyas en cascada: devolver la entidad arrastraba
 * `store.direccion.codigoPostal.municipio`, `zone.municipioId`, `activo`,
 * `updatedAt` y demás columnas de tablas de otro dueño. Eso tenía tres
 * consecuencias malas:
 *
 *  1. el XML dejaba de validar contra el XSD en cuanto catalog-service
 *     agregaba una columna, y el cliente de escritorio valida con XSD;
 *  2. `findAll` (QueryBuilder, ignora eager) y `findOne` (repository,
 *     sí los aplica) devolvían formas DISTINTAS del mismo recurso;
 *  3. se filtraban datos de catálogo que este servicio no posee.
 *
 * Con estos mapeadores la respuesta es explícita y estable: lo que no
 * esté aquí no sale, y agregar una columna en una tabla ajena no cambia
 * el contrato.
 */

export interface ReferenciaCatalogo {
  id: string;
  nombre: string | null;
}

export interface DetalleRespuesta {
  id: string;
  presentationId: string;
  /**
   * Se expone plano aunque la tabla NO lo guarde: el detalle apunta solo a
   * la presentación (RF-35) y el producto sale por join. Guardar ambos
   * permitiría contradicción; exponerlo le ahorra al cliente navegar
   * `presentation.producto.id`.
   */
  productId: string | null;
  presentationName: string | null;
  productSku: string | null;
  quantity: string;
  unitPrice: string;
  subtotal: string;
}

export interface TransaccionRespuesta {
  id: string;
  folio: string;
  storeId: string;
  store: ReferenciaCatalogo | null;
  fecha: Date;
  total: string;
  canal: string;
  importacionId: string | null;
  capturadaPor: string | null;
  createdAt: Date;
  details: DetalleRespuesta[];
}

export interface CanastaRespuesta {
  id: string;
  transactionId: string;
  storeId: string | null;
  zoneId: string;
  zone: ReferenciaCatalogo | null;
  segmentId: number | null;
  date: Date;
  totalValue: string;
  productCount: number;
  unitsTotal: string;
  basicProductsCount: number;
  /** Derivado de `basicProductsCount`: el filtro `hasBasicProducts` opera sobre esto. */
  hasBasicProducts: boolean;
  builtAt: Date;
}

function referencia(
  entidad: { id?: string; nombre?: string } | null | undefined,
  id: string | null,
): ReferenciaCatalogo | null {
  if (entidad?.id) return { id: entidad.id, nombre: entidad.nombre ?? null };
  return id ? { id, nombre: null } : null;
}

export function aDetalleRespuesta(detalle: TransactionDetail): DetalleRespuesta {
  const presentacion = detalle.presentation;
  return {
    id: detalle.id,
    presentationId: detalle.presentationId,
    productId: presentacion?.productoId ?? null,
    presentationName: presentacion?.nombre ?? null,
    productSku: presentacion?.producto?.sku ?? null,
    quantity: detalle.quantity,
    unitPrice: detalle.unitPrice,
    subtotal: detalle.subtotal,
  };
}

export function aTransaccionRespuesta(transaccion: Transaction): TransaccionRespuesta {
  return {
    id: transaccion.id,
    folio: transaccion.folio,
    storeId: transaccion.storeId,
    store: referencia(transaccion.store, transaccion.storeId),
    fecha: transaccion.fecha,
    total: transaccion.total,
    canal: transaccion.canal,
    importacionId: transaccion.importacionId,
    capturadaPor: transaccion.capturadaPor,
    createdAt: transaccion.createdAt,
    // Orden estable: el cliente de escritorio compara corridas.
    details: [...(transaccion.details ?? [])]
      .sort((a, b) => a.presentationId.localeCompare(b.presentationId))
      .map(aDetalleRespuesta),
  };
}

export function aCanastaRespuesta(canasta: Basket): CanastaRespuesta {
  return {
    id: canasta.id,
    transactionId: canasta.transactionId,
    // La tienda no es columna de `canastas`: se llega por su transacción.
    // Solo viaja si la consulta la trajo.
    storeId: canasta.transaction?.storeId ?? null,
    zoneId: canasta.zoneId,
    zone: referencia(canasta.zone, canasta.zoneId),
    segmentId: canasta.segmentId,
    date: canasta.date,
    totalValue: canasta.totalValue,
    productCount: canasta.productCount,
    unitsTotal: canasta.unitsTotal,
    basicProductsCount: canasta.basicProductsCount,
    hasBasicProducts: canasta.basicProductsCount > 0,
    builtAt: canasta.builtAt,
  };
}
