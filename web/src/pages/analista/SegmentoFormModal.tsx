import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { CrearSegmentoPayload, actualizarSegmento, crearSegmento } from '../../api/segmentos';
import { IncomeSegment } from '../../types';

interface SegmentoFormModalProps {
  /** `undefined` = alta; con segmento = edición. */
  segmento?: IncomeSegment;
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

export function SegmentoFormModal({ segmento, onCerrar, onGuardado }: SegmentoFormModalProps) {
  const esEdicion = !!segmento;

  const [code, setCode] = useState(segmento?.code ?? '');
  const [name, setName] = useState(segmento?.name ?? '');
  const [incomeRangeMin, setIncomeRangeMin] = useState(segmento?.incomeRangeMin ?? '');
  const [incomeRangeMax, setIncomeRangeMax] = useState(segmento?.incomeRangeMax ?? '');
  const [source, setSource] = useState(segmento?.source ?? '');
  const [updateFrequency, setUpdateFrequency] = useState(segmento?.updateFrequency ?? '');
  const [zoneRelation, setZoneRelation] = useState(segmento?.zoneRelation ?? '');
  const [limitations, setLimitations] = useState(segmento?.limitations ?? '');
  const [description, setDescription] = useState(segmento?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const payload: CrearSegmentoPayload = {
      code: code.trim(),
      name: name.trim(),
      incomeRangeMin: Number(incomeRangeMin),
      incomeRangeMax: incomeRangeMax === '' ? undefined : Number(incomeRangeMax),
      source: source.trim(),
      updateFrequency: updateFrequency.trim(),
      zoneRelation: zoneRelation.trim(),
      limitations: limitations.trim(),
      description: description.trim() || undefined,
    };

    if (
      payload.incomeRangeMax !== undefined &&
      payload.incomeRangeMax <= payload.incomeRangeMin
    ) {
      setError('El ingreso máximo debe ser mayor que el mínimo (o déjalo vacío si no hay tope).');
      return;
    }

    setGuardando(true);
    try {
      if (esEdicion) {
        await actualizarSegmento(segmento.id, payload);
        onGuardado('Segmento actualizado correctamente.');
      } else {
        await crearSegmento(payload);
        onGuardado('Segmento creado correctamente.');
      }
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar el segmento.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={esEdicion ? 'Editar segmento de ingreso' : 'Nuevo segmento de ingreso'}
      descripcion="El rango numérico no basta: RN-01/RN-02 y la retroalimentación del profesor exigen justificar fuente, frecuencia de actualización, relación con zona y limitaciones."
      onCerrar={onCerrar}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Campo id="segmento-code" label="Código">
            <input
              id="segmento-code"
              type="text"
              required
              maxLength={20}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ING_1"
              className={inputClass}
            />
          </Campo>
          <Campo id="segmento-name" label="Nombre">
            <input
              id="segmento-name"
              type="text"
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ingreso bajo"
              className={inputClass}
            />
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo id="segmento-min" label="Ingreso mínimo">
            <input
              id="segmento-min"
              type="number"
              required
              min={0}
              step="0.01"
              value={incomeRangeMin}
              onChange={(e) => setIncomeRangeMin(e.target.value)}
              className={inputClass}
            />
          </Campo>
          <Campo id="segmento-max" label="Ingreso máximo (vacío = sin tope)">
            <input
              id="segmento-max"
              type="number"
              min={0}
              step="0.01"
              value={incomeRangeMax}
              onChange={(e) => setIncomeRangeMax(e.target.value)}
              className={inputClass}
            />
          </Campo>
        </div>

        <Campo id="segmento-source" label="Fuente">
          <input
            id="segmento-source"
            type="text"
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="INEGI - ENIGH, ingreso corriente trimestral por hogar (AMM)"
            className={inputClass}
          />
        </Campo>

        <Campo id="segmento-frecuencia" label="Frecuencia de actualización">
          <input
            id="segmento-frecuencia"
            type="text"
            required
            maxLength={60}
            value={updateFrequency}
            onChange={(e) => setUpdateFrequency(e.target.value)}
            placeholder="Anual, al publicarse la ENIGH"
            className={inputClass}
          />
        </Campo>

        <Campo id="segmento-relacion-zona" label="Relación con zona">
          <textarea
            id="segmento-relacion-zona"
            required
            rows={2}
            value={zoneRelation}
            onChange={(e) => setZoneRelation(e.target.value)}
            placeholder="Se asigna a la ZONA agregada (RN-02); nunca a una persona ni compra individual."
            className={inputClass}
          />
        </Campo>

        <Campo id="segmento-limitaciones" label="Limitaciones">
          <textarea
            id="segmento-limitaciones"
            required
            rows={2}
            value={limitations}
            onChange={(e) => setLimitations(e.target.value)}
            placeholder="No captura variación de ingreso dentro de la misma zona."
            className={inputClass}
          />
        </Campo>

        <Campo id="segmento-descripcion" label="Descripción (opcional)">
          <input
            id="segmento-descripcion"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </Campo>

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
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear segmento'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputClass =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';

function Campo({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}
