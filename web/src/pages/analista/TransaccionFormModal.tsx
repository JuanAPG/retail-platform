import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { CrearTransaccionLinea, crearTransaccion } from '../../api/transacciones';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { IconCerrar } from '../../components/ui/icons';
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

const inputCls =
  'h-11 w-full rounded-full border-2 border-transparent bg-arena px-4 text-sm text-tinta outline-none transition placeholder:text-salvia focus:border-vino focus:bg-marfil hover:border-salvia/60 disabled:cursor-not-allowed disabled:opacity-50';

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

  return (
    <Modal titulo="Nueva transacción" descripcion="Registro manual. Al guardar se construye su canasta (M07)." onCerrar={onCerrar}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Select id="trx-tienda" label="Tienda" value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="Elige…">
            {tiendas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </Select>
          <Field id="trx-fecha" label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>

        <Field
          id="trx-folio"
          label="Folio (único por tienda)"
          value={folio}
          onChange={(e) => setFolio(e.target.value)}
          placeholder="T-2026-0001"
          maxLength={40}
        />

        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-salvia">Líneas</p>
          {lineas.map((l, i) => {
            const producto = productos.find((p) => p.id === l.productoId);
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-card border-2 border-arena p-2.5">
                <Select
                  id={`trx-linea-${i}-producto`}
                  value={l.productoId}
                  onChange={(e) => elegirProducto(i, e.target.value)}
                  placeholder="Producto…"
                >
                  {productos
                    .filter((p) => p.estatus === 'activo')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.nombre}
                      </option>
                    ))}
                </Select>
                <Select
                  id={`trx-linea-${i}-presentacion`}
                  value={l.presentationId}
                  onChange={(e) => actualizarLinea(i, { presentationId: e.target.value })}
                  disabled={!producto}
                  placeholder="Presentación…"
                >
                  {(producto?.presentaciones ?? []).map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.nombre}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))}
                  disabled={lineas.length === 1}
                  aria-label={`Quitar línea ${i + 1}`}
                  className="flex h-14 w-11 items-center justify-center rounded-full border-2 border-salvia/60 text-teal transition hover:bg-vino hover:text-arena disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <IconCerrar className="h-4 w-4" />
                </button>
                <input
                  className={`${inputCls} font-data tabular-nums`}
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Cantidad"
                  value={l.quantity}
                  onChange={(e) => actualizarLinea(i, { quantity: e.target.value })}
                  aria-label={`Cantidad línea ${i + 1}`}
                />
                <input
                  className={`${inputCls} font-data tabular-nums`}
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Precio"
                  value={l.unitPrice}
                  onChange={(e) => actualizarLinea(i, { unitPrice: e.target.value })}
                  aria-label={`Precio línea ${i + 1}`}
                />
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setLineas((prev) => [...prev, { ...LINEA_VACIA }])}
            className="self-start rounded-full px-3 py-2 text-sm font-bold text-teal transition hover:bg-salvia/25"
          >
            + Agregar línea
          </button>
        </div>

        {error && (
          <p role="alert" className="rounded-full bg-vino/10 px-4 py-2.5 text-sm font-semibold text-vino">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCerrar}
            className="flex h-11 items-center rounded-full border-2 border-salvia/60 px-5 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex h-11 items-center rounded-full bg-vino px-5 text-sm font-bold text-arena transition hover:bg-teal disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
