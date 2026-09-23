import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import {
  ActualizarProductoPayload,
  CrearProductoDirectoPayload,
  actualizarProducto,
  crearProductoDirecto,
} from '../../api/catalogo';
import { CategoriaProducto, Producto, UnidadMedida } from '../../types';

interface ProductoFormModalProps {
  /** `undefined` = alta directa; con producto = edición. */
  producto?: Producto;
  categorias: CategoriaProducto[];
  unidadesMedida: UnidadMedida[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

/**
 * Alta directa (Admin/Gerente) o edición de un producto. Distinto del
 * flujo de propuesta de Proveedor: aquí el producto nace 'activo' de
 * inmediato y sí se puede marcar `esCanastaBasica` (RN-04, decisión del
 * Gerente, no de quien vende).
 */
export function ProductoFormModal({
  producto,
  categorias,
  unidadesMedida,
  onCerrar,
  onGuardado,
}: ProductoFormModalProps) {
  const esEdicion = !!producto;

  const [sku, setSku] = useState(producto?.sku ?? '');
  const [nombre, setNombre] = useState(producto?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? '');
  const [categoriaId, setCategoriaId] = useState<number>(producto?.categoriaId ?? categorias[0]?.id ?? 0);
  const [esCanastaBasica, setEsCanastaBasica] = useState(producto?.esCanastaBasica ?? false);
  // Solo aplican al ALTA: un producto ya existente edita sus
  // presentaciones desde el modal "Presentaciones", no desde aquí.
  const [presentacion, setPresentacion] = useState('1 kg');
  const [contenido, setContenido] = useState('1');
  const [unidadMedida, setUnidadMedida] = useState(unidadesMedida[0]?.clave ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!categoriaId) {
      setError('Selecciona una categoría.');
      return;
    }

    setGuardando(true);
    try {
      if (esEdicion) {
        const payload: ActualizarProductoPayload = {
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || undefined,
          categoriaId,
          esCanastaBasica,
        };
        await actualizarProducto(producto.id, payload);
        onGuardado('Producto actualizado correctamente.');
      } else {
        if (!unidadMedida) {
          setError('Selecciona una unidad de medida.');
          setGuardando(false);
          return;
        }
        const payload: CrearProductoDirectoPayload = {
          sku: sku.trim(),
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || undefined,
          categoriaId,
          esCanastaBasica,
          presentacion: presentacion.trim(),
          contenido: Number(contenido),
          unidadMedida,
        };
        await crearProductoDirecto(payload);
        onGuardado('Producto creado correctamente.');
      }
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar el producto.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={esEdicion ? 'Editar producto' : 'Nuevo producto'}
      descripcion={
        esEdicion
          ? 'Las presentaciones se administran aparte, desde «Presentaciones».'
          : 'Nace activo de inmediato — a diferencia de una propuesta de proveedor, no requiere aprobación.'
      }
      onCerrar={onCerrar}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Campo id="producto-sku" label="SKU">
            <input
              id="producto-sku"
              type="text"
              required
              disabled={esEdicion}
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
            />
          </Campo>
          <Campo id="producto-nombre" label="Nombre">
            <input
              id="producto-nombre"
              type="text"
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={inputClass}
            />
          </Campo>
        </div>

        <Campo id="producto-descripcion" label="Descripción (opcional)">
          <textarea
            id="producto-descripcion"
            rows={2}
            value={descripcion ?? ''}
            onChange={(e) => setDescripcion(e.target.value)}
            className={inputClass}
          />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo id="producto-categoria" label="Categoría">
            <select
              id="producto-categoria"
              value={categoriaId}
              onChange={(e) => setCategoriaId(Number(e.target.value))}
              className={inputClass}
            >
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={esCanastaBasica}
              onChange={(e) => setEsCanastaBasica(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Es canasta básica
          </label>
        </div>

        {!esEdicion && (
          <>
            <p className="text-xs font-medium uppercase text-slate-400">Primera presentación</p>
            <div className="grid grid-cols-3 gap-3">
              <Campo id="producto-presentacion" label="Nombre">
                <input
                  id="producto-presentacion"
                  type="text"
                  required
                  value={presentacion}
                  onChange={(e) => setPresentacion(e.target.value)}
                  className={inputClass}
                />
              </Campo>
              <Campo id="producto-contenido" label="Contenido">
                <input
                  id="producto-contenido"
                  type="number"
                  required
                  min={0}
                  step="0.001"
                  value={contenido}
                  onChange={(e) => setContenido(e.target.value)}
                  className={inputClass}
                />
              </Campo>
              <Campo id="producto-unidad" label="Unidad">
                <select
                  id="producto-unidad"
                  value={unidadMedida}
                  onChange={(e) => setUnidadMedida(e.target.value)}
                  className={inputClass}
                >
                  {unidadesMedida.map((u) => (
                    <option key={u.clave} value={u.clave}>
                      {u.clave} — {u.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputClass =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';

function Campo({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}
