import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { CrearSegmentoPayload, actualizarSegmento, crearSegmento } from '../../api/segmentos';
import { Field } from '../../components/ui/Field';
import { TextArea } from '../../components/ui/TextArea';
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
          <Field
            id="segmento-code"
            label="Código"
            required
            maxLength={20}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ING_1"
            dataFont
          />
          <Field
            id="segmento-name"
            label="Nombre"
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ingreso bajo"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            id="segmento-min"
            label="Ingreso mínimo"
            type="number"
            required
            min={0}
            step="0.01"
            value={incomeRangeMin}
            onChange={(e) => setIncomeRangeMin(e.target.value)}
            dataFont
          />
          <Field
            id="segmento-max"
            label="Ingreso máximo (vacío = sin tope)"
            type="number"
            min={0}
            step="0.01"
            value={incomeRangeMax}
            onChange={(e) => setIncomeRangeMax(e.target.value)}
            dataFont
          />
        </div>

        <Field
          id="segmento-source"
          label="Fuente"
          required
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="INEGI - ENIGH, ingreso corriente trimestral por hogar (AMM)"
        />

        <Field
          id="segmento-frecuencia"
          label="Frecuencia de actualización"
          required
          maxLength={60}
          value={updateFrequency}
          onChange={(e) => setUpdateFrequency(e.target.value)}
          placeholder="Anual, al publicarse la ENIGH"
        />

        <TextArea
          id="segmento-relacion-zona"
          label="Relación con zona"
          required
          rows={2}
          value={zoneRelation}
          onChange={(e) => setZoneRelation(e.target.value)}
          placeholder="Se asigna a la ZONA agregada (RN-02); nunca a una persona ni compra individual."
        />

        <TextArea
          id="segmento-limitaciones"
          label="Limitaciones"
          required
          rows={2}
          value={limitations}
          onChange={(e) => setLimitations(e.target.value)}
          placeholder="No captura variación de ingreso dentro de la misma zona."
        />

        <Field
          id="segmento-descripcion"
          label="Descripción (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear segmento'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
