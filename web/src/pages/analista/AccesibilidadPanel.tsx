import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { Select } from '../../components/ui/Select';
import { ErrorText } from '../../components/ui/ErrorText';
import { StatusPill } from '../../components/ui/StatusPill';
import { useFetch } from '../../hooks/useFetch';
import { calcularAccesibilidad, getHistorialAccesibilidad, IndiceAccesibilidad } from '../../api/accesibilidad';
import { mensajeDeError } from '../../api/errores';
import { IncomeSegment, Zona } from '../../types';

const formatoPorcentaje = new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 });
const formatoMoneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

function toneDeIndice(valor: number): 'ok' | 'warn' | 'neutral' {
  if (valor >= 0.6) return 'ok';
  if (valor < 0.4) return 'warn';
  return 'neutral';
}

/**
 * M12 — Accesibilidad: combina precio, ingreso del segmento, disponibilidad
 * y cobertura de básicos en un solo índice por zona. Es un indicador
 * analítico para comparar zonas entre sí, no una medida absoluta de
 * bienestar ni un sustituto de "precio bajo".
 */
export function AccesibilidadPanel({ zonas, segmentos }: { zonas: Zona[]; segmentos: IncomeSegment[] }) {
  const [zonaId, setZonaId] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<IndiceAccesibilidad | null>(null);

  const historial = useFetch(
    () => (zonaId ? getHistorialAccesibilidad(zonaId) : Promise.resolve<IndiceAccesibilidad[]>([])),
    [zonaId, resultado],
  );

  async function calcular(e: React.FormEvent) {
    e.preventDefault();
    if (!zonaId || !segmentId || calculando) return;
    setCalculando(true);
    setError(null);
    try {
      const r = await calcularAccesibilidad(zonaId, segmentId);
      setResultado(r);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo calcular la accesibilidad. Intenta de nuevo.'));
    } finally {
      setCalculando(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Accesibilidad"
        description="Qué tan alcanzable es la canasta básica en una zona para el segmento de ingreso elegido: combina precio, ingreso, disponibilidad y cobertura de básicos."
      />

      <form onSubmit={calcular} className="flex flex-col gap-4 rounded-panel bg-arena p-6">
        <h2 className="font-slab text-[22px] text-vino">Calcular</h2>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <Select id="acc-zona" label="Zona" value={zonaId} onChange={(e) => setZonaId(e.target.value)} placeholder="Elige una zona">
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>{z.nombre}</option>
            ))}
          </Select>
          <Select
            id="acc-segmento"
            label="Segmento de ingreso"
            value={segmentId}
            onChange={(e) => setSegmentId(e.target.value)}
            placeholder="Elige un segmento"
          >
            {segmentos.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-semibold text-vino">{error}</p>
          <button
            type="submit"
            disabled={!zonaId || !segmentId || calculando}
            className="flex h-[52px] shrink-0 items-center rounded-full bg-teal px-6 text-[15px] font-bold text-arena transition hover:bg-vino disabled:opacity-50"
          >
            {calculando ? 'Calculando…' : 'Calcular'}
          </button>
        </div>
      </form>

      {resultado && (
        <div className="flex flex-col gap-3 rounded-panel bg-arena p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-slab text-[22px] text-vino">Resultado</h2>
            <StatusPill tone={toneDeIndice(resultado.indexValue)}>{formatoPorcentaje.format(resultado.indexValue)}</StatusPill>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-teal sm:grid-cols-2">
            <p>
              <span className="text-teal/70">Costo de la canasta básica en la zona: </span>
              {formatoMoneda.format(resultado.basicBasketCost)}
            </p>
            <p>
              <span className="text-teal/70">Ingreso estimado del segmento: </span>
              {resultado.estimatedIncome === null ? '—' : formatoMoneda.format(resultado.estimatedIncome)}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-teal/70">Historial de la zona</h2>
        {!zonaId && <p className="px-1 text-sm text-teal/70">Elige una zona para ver sus análisis anteriores.</p>}
        {historial.error && <ErrorText>{historial.error}</ErrorText>}
        {zonaId && historial.data && historial.data.length === 0 && (
          <p className="px-1 text-sm text-teal/70">Esta zona no tiene análisis de accesibilidad todavía.</p>
        )}
        {historial.data && historial.data.length > 0 && (
          <div className="flex flex-col gap-2">
            {historial.data.map((h, i) => (
              <div key={h.calculatedAt ?? i} className="flex items-center gap-3.5 rounded-full bg-arena p-2 pr-4">
                <StatusPill tone={toneDeIndice(h.indexValue)}>{formatoPorcentaje.format(h.indexValue)}</StatusPill>
                <span className="font-data text-xs text-teal">
                  {h.calculatedAt ? new Date(h.calculatedAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
