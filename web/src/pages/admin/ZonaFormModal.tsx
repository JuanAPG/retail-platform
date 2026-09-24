import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { CrearZonaPayload, actualizarZona, crearZona } from '../../api/catalogo';
import { Municipio, Zona } from '../../types';

interface ZonaFormModalProps {
  /** `undefined` = alta; con zona = edición. */
  zona?: Zona;
  municipios: Municipio[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

export function ZonaFormModal({ zona, municipios, onCerrar, onGuardado }: ZonaFormModalProps) {
  const esEdicion = !!zona;

  const [nombre, setNombre] = useState(zona?.nombre ?? '');
  const [municipioId, setMunicipioId] = useState<number>(zona?.municipioId ?? municipios[0]?.id ?? 0);
  const [descripcion, setDescripcion] = useState(zona?.descripcion ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!municipioId) {
      setError('Selecciona un municipio.');
      return;
    }

    const payload: CrearZonaPayload = {
      nombre: nombre.trim(),
      municipioId,
      descripcion: descripcion.trim() || undefined,
    };

    setGuardando(true);
    try {
      if (esEdicion) {
        await actualizarZona(zona.id, payload);
        onGuardado('Zona actualizada correctamente.');
      } else {
        await crearZona(payload);
        onGuardado('Zona creada correctamente.');
      }
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar la zona.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={esEdicion ? 'Editar zona' : 'Nueva zona'}
      descripcion="El ingreso estimado, la población y la disponibilidad no se capturan aquí: los calcula el módulo de Analítica."
      onCerrar={onCerrar}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="zona-nombre" className="mb-1 block text-xs font-medium uppercase text-slate-500">
            Nombre
          </label>
          <input
            id="zona-nombre"
            type="text"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="zona-municipio" className="mb-1 block text-xs font-medium uppercase text-slate-500">
            Municipio
          </label>
          <select
            id="zona-municipio"
            value={municipioId}
            onChange={(e) => setMunicipioId(Number(e.target.value))}
            className={inputClass}
          >
            {municipios.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="zona-descripcion" className="mb-1 block text-xs font-medium uppercase text-slate-500">
            Descripción (opcional)
          </label>
          <textarea
            id="zona-descripcion"
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className={inputClass}
          />
        </div>

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
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear zona'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputClass =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';
