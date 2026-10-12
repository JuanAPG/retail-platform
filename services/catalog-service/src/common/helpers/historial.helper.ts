import { EntityManager } from 'typeorm';

/**
 * Resultado de un DELETE que respeta el historial (D-07): o se borró de
 * verdad (nada dependía de la fila) o quedó desactivada y se devuelve la
 * entidad. Nunca se pierde el historial de precios, inventario ni ventas.
 */
export type ResultadoBaja<T> = { eliminado: true } | { eliminado: false; entidad: T };

/** Tablas (de otros dueños) que cuelgan de una tienda y que el CASCADE se llevaría. */
const TABLAS_DE_TIENDA = ['precios', 'inventario', 'transacciones'] as const;
/** Ídem para una presentación. */
const TABLAS_DE_PRESENTACION = ['precios', 'inventario', 'transacciones_detalle', 'precios_propuestos_proveedor'] as const;

async function existeFila(manager: EntityManager, tabla: string, columna: string, id: string): Promise<boolean> {
  // `tabla` y `columna` salen de las constantes de arriba, nunca del cliente.
  const filas = await manager.query(`SELECT 1 FROM ${tabla} WHERE ${columna} = $1 LIMIT 1`, [id]);
  return filas.length > 0;
}

export async function tiendaTieneHistorial(manager: EntityManager, tiendaId: string): Promise<boolean> {
  for (const tabla of TABLAS_DE_TIENDA) {
    if (await existeFila(manager, tabla, 'tienda_id', tiendaId)) return true;
  }
  return false;
}

export async function presentacionTieneHistorial(manager: EntityManager, presentacionId: string): Promise<boolean> {
  for (const tabla of TABLAS_DE_PRESENTACION) {
    if (await existeFila(manager, tabla, 'presentacion_id', presentacionId)) return true;
  }
  return false;
}
