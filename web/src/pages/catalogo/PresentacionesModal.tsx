import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { Select } from '../../components/ui/Select';
import { ErrorText } from '../../components/ui/ErrorText';
import { mensajeDeError } from '../../api/errores';
import { agregarPresentacion, eliminarPresentacion, getPresentaciones } from '../../api/catalogo';
import { useFetch } from '../../hooks/useFetch';
import { Producto, UnidadMedida } from '../../types';

interface PresentacionesModalProps {
  producto: Producto;
  unidadesMedida: UnidadMedida[];
  onCerrar: () => void;
}

const inputClass =
  'h-12 rounded-full border-2 border-transparent bg-arena px-4 text-sm text-tinta outline-none transition placeholder:text-salvia focus:border-vino focus:bg-marfil hover:border-salvia/60';

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
      {presentaciones.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {presentaciones.error && <ErrorText>{presentaciones.error}</ErrorText>}

      {presentaciones.data && presentaciones.data.length > 0 && (
        <ul className="mb-4 divide-y divide-salvia/20 rounded-card border-2 border-arena">
          {presentaciones.data.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm text-tinta">
              <span className="flex items-center gap-2">
                {p.nombre} ({p.contenido} {p.unidadMedida?.clave})
                {p.esPredeterminada && <Badge tone="positive">Predeterminada</Badge>}
              </span>
              <button
                type="button"
                onClick={() => handleEliminar(p.id)}
                disabled={eliminandoId === p.id}
                className="text-sm font-semibold text-vino underline decoration-vino/40 transition hover:text-teal disabled:opacity-40"
              >
                {eliminandoId === p.id ? 'Eliminando…' : 'Eliminar'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {presentaciones.data && presentaciones.data.length === 0 && (
        <p className="mb-4 text-sm text-teal/70">Este producto no tiene presentaciones.</p>
      )}

      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-salvia">Agregar presentación</p>
      <form onSubmit={handleAgregar} className="grid grid-cols-3 gap-2.5">
        <input
          id="presentacion-nombre"
          type="text"
          placeholder="Nombre (ej. 250 g)"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className={inputClass}
        />
        <input
          id="presentacion-contenido"
          type="number"
          placeholder="Contenido"
          min={0}
          step="0.001"
          value={contenido}
          onChange={(e) => setContenido(e.target.value)}
          className={`${inputClass} font-data tabular-nums`}
        />
        <Select id="presentacion-unidad" value={unidadMedida} onChange={(e) => setUnidadMedida(e.target.value)}>
          {unidadesMedida.map((u) => (
            <option key={u.clave} value={u.clave}>
              {u.clave}
            </option>
          ))}
        </Select>
        <button
          type="submit"
          disabled={agregando}
          className="col-span-3 flex h-12 items-center justify-center rounded-full bg-vino text-sm font-bold text-arena transition hover:bg-teal disabled:opacity-50"
        >
          {agregando ? 'Agregando…' : 'Agregar presentación'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 rounded-full bg-vino/10 px-4 py-2.5 text-sm font-semibold text-vino">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onCerrar}
          className="flex h-11 items-center rounded-full border-2 border-salvia/60 px-5 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta"
        >
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
