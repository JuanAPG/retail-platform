import { estaActivo, PresentacionCatalogo, ProductoCatalogo, TiendaCatalogo } from './common/catalog/catalog-client.service';
import { esFechaFutura, parsearDecimal, parsearFecha } from './fecha.util';
import { RawRow } from './files';

type Detail = { presentationId: string; quantity: number; unitPrice: number };
export type Sale = { storeId: string; folio: string; fecha: string; details: Detail[] };
type RowResult = 'valida' | 'rechazada' | 'conflicto';
type Row = { row_no: number; sale_no?: number; result: RowResult; code?: string; message?: string };
type IndexedSale = { sale_no: number; payload: Sale; rows: Row[]; rejected: boolean };

export function prepare(rows: RawRow[], stores: TiendaCatalogo[], products: ProductoCatalogo[]) {
  const shops = new Map(stores.filter(estaActivo).map((store) => [store.nombre.trim().toLowerCase(), store.id]));
  const presentations = new Map<string, PresentacionCatalogo>();
  for (const product of products.filter((item) => item.estatus === 'activo')) {
    for (const item of (product.presentaciones ?? []).filter(estaActivo)) {
      presentations.set(JSON.stringify([product.sku.trim().toLowerCase(), item.nombre.trim().toLowerCase()]), item);
    }
  }
  const groups = new Map<string, IndexedSale>();
  const invalidGroups = new Set<string>();
  const staged = rows.map((raw, index): Row => {
    const row = index + 1;
    const cell = (name: string): string => {
      const value = raw?.[name];
      return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    };
    const folio = cell('folio');
    const storeId = shops.get(cell('tienda').toLowerCase());
    const key = JSON.stringify([storeId, folio]);
    const reject = (code: string, message: string): Row => {
      if (key) invalidGroups.add(key);
      return { row_no: row, result: 'rechazada', code, message };
    };
    if (!raw || raw.malformed) return reject('FILA_INVALIDA', 'La fila tiene una estructura inválida.');
    if (!storeId) return reject('TIENDA_INVALIDA', 'La tienda no existe o está inactiva.');
    if (!folio || folio.length > 40) return reject('FOLIO_INVALIDO', 'El folio requiere de 1 a 40 caracteres.');
    const fecha = parsearFecha(cell('fecha'));
    if (!fecha || esFechaFutura(fecha)) return reject('FECHA_INVALIDA', 'La fecha no es válida o es futura.');
    const presentation = presentations.get(JSON.stringify([cell('sku').toLowerCase(), cell('presentacion').toLowerCase()]));
    if (!presentation) return reject('PRESENTACION_INVALIDA', 'La presentación no existe o está inactiva.');
    const quantity = parsearDecimal(cell('cantidad'));
    const unitPrice = parsearDecimal(cell('precio'));
    if (!quantity || quantity > 99999999.99) return reject('CANTIDAD_INVALIDA', 'La cantidad excede el rango permitido.');
    if (!unitPrice || unitPrice > 9999999999.99) return reject('PRECIO_INVALIDO', 'El precio excede el rango permitido.');

    const timestamp = fecha.toISOString();
    const group = groups.get(key) ?? {
      sale_no: row, payload: { storeId, folio, fecha: timestamp, details: [] }, rows: [], rejected: false,
    };
    groups.set(key, group);
    if (group.payload.fecha !== timestamp || group.payload.details.some((line) => line.presentationId === presentation.id)) {
      group.rejected = true;
    }
    group.payload.details.push({ presentationId: presentation.id, quantity, unitPrice });
    const current: Row = { row_no: row, sale_no: group.sale_no, result: 'valida' };
    group.rows.push(current);
    return current;
  });

  const sales = [];
  for (const [key, group] of groups) {
    if (invalidGroups.has(key) || group.rejected) {
      for (const row of group.rows) Object.assign(row, { sale_no: undefined, result: 'conflicto',
        code: 'VENTA_INCONSISTENTE', message: 'El folio tiene filas rechazadas, fechas distintas o una presentación repetida.' });
    } else {
      sales.push({ sale_no: group.sale_no, payload: group.payload });
    }
  }
  return { staged, sales };
}
