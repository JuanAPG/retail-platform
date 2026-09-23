import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { mensajeDeError } from '../../api/errores';
import { agregarPresentacion, eliminarPresentacion, getPresentaciones } from '../../api/catalogo';
import { useFetch } from '../../hooks/useFetch';
import { Producto, UnidadMedida } from '../../types';

interface PresentacionesModalProps {
  producto: Producto;
  unidadesMedida: UnidadMedida[];
  onCerrar: () => void;
}

/**
 * RF-35: un producto tiene varias presentaciones. Se administran aquí,
 * separado de editar el producto, porque cada presentación es lo que
 * de verdad se vende y tiene precio propio (M08).
 */
export function PresentacionesModal({ producto, unidadesMedida, onCerrar }: PresentacionesModalProps) {
  const presentaciones = useFetch(() => getPresentaciones(producto.id), [producto.id]);

  const [nombre, setNombre] = useState('');
  const [contenido, setContenido] = useState('');
  const [unidadMedida, setUnidadMedida] = useState(unidadesMedida[0]?.clave ?? '');
  const [agregando, setAgregando] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAgregar(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!nombre.trim() || !contenido || !unidadMedida) {
      setError('Completa nombre, contenido y unidad.');
      return;
    }

    setAgregando(true);
    try {
      await agregarPresentacion(producto.id, {
        nombre: nombre.trim(),
        contenido: Number(contenido),
        unidadMedida,
      });
      setNombre('');
      setContenido('');
      presentaciones.refetch();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo agregar la presentación.'));
    } finally {
      setAgregando(false);
    }
  }

  async function handleEliminar(id: string) {
    setError(null);
    setEliminandoId(id);
    try {
      await eliminarPresentacion(id);
      presentaciones.refetch();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo eliminar la presentación.'));
    } finally {
      setEliminandoId(null);
    }
  }

  return (
    <Modal
      titulo={`Presentaciones — ${producto.nombre}`}
      descripcion="Precio, inventario y ventas van por presentación, no por el producto en general."
      onCerrar={onCerrar}
    >
      {presentaciones.loading && <p className="text-sm text-slate-500">Cargando…</p>}
      {presentaciones.error && <p className="text-sm text-rose-600">{presentaciones.error}</p>}

      {presentaciones.data && presentaciones.data.length > 0 && (
        <ul className="mb-4 divide-y divide-slate-100 rounded border border-slate-200">
          {presentaciones.data.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {p.nombre} ({p.contenido} {p.unidadMedida?.clave})
                {p.esPredeterminada && (
                  <Badge tone="positive"> Predeterminada</Badge>
                )}
              </span>
              <button
                type="button"
                onClick={() => handleEliminar(p.id)}
                disabled={eliminandoId === p.id}
                className="text-sm text-rose-600 underline hover:text-rose-800 disabled:opacity-40"
              >
                {eliminandoId === p.id ? 'Eliminando…' : 'Eliminar'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {presentaciones.data && presentaciones.data.length === 0 && (
        <p className="mb-4 text-sm text-slate-500">Este producto no tiene presentaciones.</p>
      )}

      <p className="mb-2 text-xs font-medium uppercase text-slate-400">Agregar presentación</p>
      <form onSubmit={handleAgregar} className="grid grid-cols-3 gap-2">
        <input
          id="presentacion-nombre"
          type="text"
          placeholder="Nombre (ej. 250 g)"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        <input
          id="presentacion-contenido"
          type="number"
          placeholder="Contenido"
          min={0}
          step="0.001"
          value={contenido}
          onChange={(e) => setContenido(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        <select
          id="presentacion-unidad"
          value={unidadMedida}
          onChange={(e) => setUnidadMedida(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        >
          {unidadesMedida.map((u) => (
            <option key={u.clave} value={u.clave}>
              {u.clave}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={agregando}
          className="col-span-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {agregando ? 'Agregando…' : 'Agregar presentación'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onCerrar}
          className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
