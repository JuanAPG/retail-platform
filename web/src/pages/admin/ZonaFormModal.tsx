import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { CrearZonaPayload, actualizarZona, crearZona } from '../../api/catalogo';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextArea } from '../../components/ui/TextArea';
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
        <Field id="zona-nombre" label="Nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />

        <Select id="zona-municipio" label="Municipio" value={municipioId} onChange={(e) => setMunicipioId(Number(e.target.value))}>
          {municipios.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </Select>

        <TextArea
          id="zona-descripcion"
          label="Descripción (opcional)"
          rows={2}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />

        {error && (
          <p role="alert" className="rounded-full bg-vino/10 px-4 py-2.5 text-sm font-semibold text-vino">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2.5">
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
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear zona'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
