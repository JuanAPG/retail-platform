import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { CrearTransaccionLinea, crearTransaccion } from '../../api/transacciones';
import { Producto, Tienda } from '../../types';

interface LineaForm {
  productoId: string;
  presentationId: string;
  quantity: string;
  unitPrice: string;
}

const LINEA_VACIA: LineaForm = { productoId: '', presentationId: '', quantity: '', unitPrice: '' };

interface TransaccionFormModalProps {
  tiendas: Tienda[];
  productos: Producto[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

/**
 * M06 — Registro manual de una transacción. El precio se captura línea
 * por línea y se congela en la venta (el catálogo de precios puede
 * cambiar después sin reescribir el histórico).
 */
export function TransaccionFormModal({ tiendas, productos, onCerrar, onGuardado }: TransaccionFormModalProps) {
  const [storeId, setStoreId] = useState('');
  const [folio, setFolio] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [lineas, setLineas] = useState<LineaForm[]>([{ ...LINEA_VACIA }]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function actualizarLinea(i: number, cambios: Partial<LineaForm>) {
    setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, ...cambios } : l)));
  }

  function elegirProducto(i: number, productoId: string) {
    // Al cambiar de producto se limpia la presentación: son de otro catálogo.
    actualizarLinea(i, { productoId, presentationId: '' });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!storeId) {
      setError('Elige la tienda donde se hizo la venta.');
      return;
    }
    if (!folio.trim()) {
      setError('El folio es obligatorio (único dentro de la tienda).');
      return;
    }

    const detalles: CrearTransaccionLinea[] = [];
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      const quantity = Number(l.quantity);
      const unitPrice = Number(l.unitPrice);
      if (!l.presentationId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        setError(`La línea ${i + 1} está incompleta: presentación, cantidad y precio deben ser válidos.`);
        return;
      }
      detalles.push({ presentationId: l.presentationId, quantity, unitPrice });
    }
    if (detalles.length === 0) {
      setError('Agrega al menos una línea a la transacción.');
      return;
    }

    setGuardando(true);
    try {
      await crearTransaccion({ storeId, folio: folio.trim(), fecha, details: detalles });
      onGuardado('Transacción registrada correctamente (canasta construida).');
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo registrar la transacción.'));
    } finally {
      setGuardando(false);
    }
  }

  const inputCls = 'w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900';
  const labelCls = 'mb-1 block text-xs font-medium text-slate-600';

  return (
    <Modal titulo="Nueva transacción" descripcion="Registro manual. Al guardar se construye su canasta (M07)." onCerrar={onCerrar}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="trx-tienda">Tienda</label>
            <select id="trx-tienda" className={inputCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">Elige…</option>
              {tiendas.map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="trx-fecha">Fecha</label>
            <input id="trx-fecha" type="date" className={inputCls} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="trx-folio">Folio (único por tienda)</label>
          <input id="trx-folio" className={inputCls} value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="T-2026-0001" maxLength={40} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">Líneas</p>
          {lineas.map((l, i) => {
            const producto = productos.find((p) => p.id === l.productoId);
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded border border-slate-200 p-2">
                <select className={inputCls} value={l.productoId} onChange={(e) => elegirProducto(i, e.target.value)} aria-label={`Producto línea ${i + 1}`}>
                  <option value="">Producto…</option>
                  {productos.filter((p) => p.estatus === 'activo').map((p) => (
                    <option key={p.id} value={p.id}>{p.sku} — {p.nombre}</option>
                  ))}
                </select>
                <select className={inputCls} value={l.presentationId} onChange={(e) => actualizarLinea(i, { presentationId: e.target.value })} disabled={!producto} aria-label={`Presentación línea ${i + 1}`}>
                  <option value="">Presentación…</option>
                  {(producto?.presentaciones ?? []).map((pr) => (
                    <option key={pr.id} value={pr.id}>{pr.nombre}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))} disabled={lineas.length === 1} aria-label={`Quitar línea ${i + 1}`} className="rounded border border-slate-300 px-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                  ✕
                </button>
                <input className={inputCls} type="number" min="0" step="any" placeholder="Cantidad" value={l.quantity} onChange={(e) => actualizarLinea(i, { quantity: e.target.value })} aria-label={`Cantidad línea ${i + 1}`} />
                <input className={inputCls} type="number" min="0" step="any" placeholder="Precio" value={l.unitPrice} onChange={(e) => actualizarLinea(i, { unitPrice: e.target.value })} aria-label={`Precio línea ${i + 1}`} />
              </div>
            );
          })}
          <button type="button" onClick={() => setLineas((prev) => [...prev, { ...LINEA_VACIA }])} className="text-sm font-medium text-slate-700 hover:text-slate-900">
            + Agregar línea
          </button>
        </div>

        {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
