import { useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { getSegmentos } from '../../api/segmentos';
import { IncomeSegment } from '../../types';
import { Hero } from '../../components/ui/Hero';
import { Card } from '../../components/ui/Card';
import { CircleButton } from '../../components/ui/CircleButton';
import { IconCerrar as IconEliminar, IconMas, IconOjo, IconSegmentos } from '../../components/ui/icons';
import { SegmentoFormModal } from './SegmentoFormModal';
import { ConfirmarEliminarSegmentoModal } from './ConfirmarEliminarSegmentoModal';

function formatoMoneda(valor: string | number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(
    Number(valor),
  );
}

function formatoRango(min: string, max: string | null): string {
  if (max == null) return `${formatoMoneda(min)}+`;
  return `${formatoMoneda(min)} – ${formatoMoneda(max)}`;
}

/**
 * M05 — Segmentos de ingreso. CRUD completo (RN-01, RN-02): el rango
 * numérico solo no basta, cada segmento debe traer su justificación
 * (fuente, frecuencia, relación con zona, limitaciones), que se captura
 * en el formulario y viaja tal cual al backend.
 */
export function SegmentosPanel() {
  const segmentos = useFetch(getSegmentos, []);

  const [formAbierto, setFormAbierto] = useState(false);
  const [segmentoEditando, setSegmentoEditando] = useState<IncomeSegment | undefined>();
  const [segmentoAEliminar, setSegmentoAEliminar] = useState<IncomeSegment | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const filas = segmentos.data ?? [];

  function cerrarForm() {
    setFormAbierto(false);
    setSegmentoEditando(undefined);
  }

  function trasGuardar(mensaje: string) {
    cerrarForm();
    setErrorAccion(null);
    setAviso(mensaje);
    segmentos.refetch();
  }

  function abrirEdicion(segmento: IncomeSegment) {
    setSegmentoEditando(segmento);
    setFormAbierto(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Segmentos"
        subtitle="Rangos de ingreso por zona (RN-01, RN-02)"
        action={
          <button
            type="button"
            onClick={() => {
              setSegmentoEditando(undefined);
              setFormAbierto(true);
            }}
            className="group flex h-[52px] items-center gap-2.5 rounded-full bg-vino py-0 pl-4.5 pr-6 text-[15px] font-bold text-arena transition hover:bg-arena hover:text-vino"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-arena text-vino transition duration-300 group-hover:rotate-90 group-hover:bg-vino group-hover:text-arena">
              <IconMas className="h-[18px] w-[18px]" />
            </span>
            Nuevo segmento
          </button>
        }
        decorations={
          <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
            <IconSegmentos className="mt-8 h-[74px] w-[74px]" />
          </div>
        }
      />

      {aviso && (
        <div className="flex items-center justify-between gap-4 rounded-full bg-salvia/25 px-5 py-3">
          <p className="text-sm font-semibold text-teal">{aviso}</p>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="text-sm text-teal">
            ✕
          </button>
        </div>
      )}
      {errorAccion && (
        <div className="rounded-full bg-vino/10 px-5 py-3">
          <p className="text-sm font-semibold text-vino">{errorAccion}</p>
        </div>
      )}
      {segmentos.error && (
        <div className="rounded-panel border-2 border-dashed border-vino/40 px-5 py-4">
          <p className="text-sm font-semibold text-vino">No se pudieron cargar los segmentos: {segmentos.error}</p>
        </div>
      )}

      {segmentos.data && filas.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconSegmentos className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">Aún no hay segmentos configurados</p>
        </div>
      )}

      {filas.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filas.map((s) => (
            <Card
              key={s.id}
              actions={
                <>
                  <CircleButton icon={<IconOjo className="h-[19px] w-[19px]" />} label={`Editar ${s.name}`} onClick={() => abrirEdicion(s)} />
                  <CircleButton
                    icon={<IconEliminar className="h-[19px] w-[19px]" />}
                    label={`Eliminar ${s.name}`}
                    variant="delete"
                    onClick={() => setSegmentoAEliminar(s)}
                  />
                </>
              }
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-[19px] leading-tight text-tinta">{s.name}</span>
                <span className="font-data rounded-full bg-marfil px-2.5 py-1 text-xs text-teal">{s.code}</span>
              </div>
              <span className="font-data text-lg font-semibold text-vino">
                {formatoRango(s.incomeRangeMin, s.incomeRangeMax)}
              </span>
              <p className="line-clamp-2 text-xs text-teal" title={s.source}>
                {s.source}
              </p>
            </Card>
          ))}
        </div>
      )}

      {formAbierto && <SegmentoFormModal segmento={segmentoEditando} onCerrar={cerrarForm} onGuardado={trasGuardar} />}

      {segmentoAEliminar && (
        <ConfirmarEliminarSegmentoModal
          segmento={segmentoAEliminar}
          onCerrar={() => setSegmentoAEliminar(null)}
          onEliminado={(mensaje) => {
            setSegmentoAEliminar(null);
            setErrorAccion(null);
            setAviso(mensaje);
            segmentos.refetch();
          }}
        />
      )}
    </div>
  );
}
