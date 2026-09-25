import { useState } from 'react';
import { AxiosError } from 'axios';
import { correrApriori } from '../../api/asociacion';
import { mensajeDeError } from '../../api/errores';
import { AnalyticsFilters, AssociationRule, IncomeSegment, Tienda, Zona } from '../../types';

const inputCls = 'w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900';
const labelCls = 'mb-1 block text-xs font-medium text-slate-600';
const ayudaCls = 'mt-1 text-xs text-slate-400';

interface CorridaAprioriFormProps {
  tiendas: Tienda[];
  zonas: Zona[];
  segmentos: IncomeSegment[];
  /** La corrida se guardó; `reglas` puede venir vacío si nada superó los umbrales. */
  onTerminada: (reglas: AssociationRule[]) => void;
  /** El backend respondió 500: la corrida quedó registrada como fallida. */
  onFallida: () => void;
}

/**
 * M10 — Formulario de una corrida de Apriori. Soporte y confianza se
 * capturan en porcentaje (así piensa un analista) y se envían como
 * fracción. Los valores iniciales están a la vista y se envían siempre
 * explícitos: el backend no aplica defaults ocultos.
 */
export function CorridaAprioriForm({ tiendas, zonas, segmentos, onTerminada, onFallida }: CorridaAprioriFormProps) {
  const [soporte, setSoporte] = useState('20');
  const [confianza, setConfianza] = useState('50');
  const [tamanoMaximo, setTamanoMaximo] = useState(3);
  const [filtros, setFiltros] = useState<AnalyticsFilters>({});
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const soporteNum = Number(soporte);
  const confianzaNum = Number(confianza);
  const errorSoporte =
    soporte.trim() === '' || !(soporteNum >= 1 && soporteNum <= 100) ? 'El soporte debe estar entre 1 y 100 %.' : null;
  const errorConfianza =
    confianza.trim() === '' || !(confianzaNum >= 0 && confianzaNum <= 100)
      ? 'La confianza debe estar entre 0 y 100 %.'
      : null;
  const fechasInvertidas = Boolean(filtros.dateFrom && filtros.dateTo && filtros.dateTo < filtros.dateFrom);
  const invalido = Boolean(errorSoporte || errorConfianza || fechasInvertidas);

  // Una tienda ya determina su zona: con zona elegida solo se ofrecen sus tiendas.
  const tiendasDisponibles = tiendas.filter((t) => !filtros.zoneId || t.zonaId === filtros.zoneId);

  function cambiarZona(zoneId: string) {
    setFiltros((f) => {
      const tienda = tiendas.find((t) => t.id === f.storeId);
      const tiendaFueraDeZona = Boolean(zoneId && tienda && tienda.zonaId !== zoneId);
      return { ...f, zoneId: zoneId || undefined, storeId: tiendaFueraDeZona ? undefined : f.storeId };
    });
  }

  async function correr(e: React.FormEvent) {
    e.preventDefault();
    if (invalido || corriendo) return;
    setCorriendo(true);
    setError(null);
    try {
      const reglas = await correrApriori({
        ...filtros,
        // toFixed evita arrastrar ruido de punto flotante (14.3 / 100 = 0.14300000000000002).
        minSupport: Number((soporteNum / 100).toFixed(4)),
        minConfidence: Number((confianzaNum / 100).toFixed(4)),
        maxItemsetSize: tamanoMaximo,
      });
      onTerminada(reglas);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo correr Apriori. Intenta de nuevo.'));
      if ((err as AxiosError).response?.status === 500) onFallida();
    } finally {
      setCorriendo(false);
    }
  }

  return (
    <form onSubmit={correr} className="mb-6 rounded border border-slate-200 px-4 py-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Nueva corrida</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls} htmlFor="apr-soporte">Soporte mínimo (%)</label>
          <input
            id="apr-soporte"
            type="number"
            min={1}
            max={100}
            step="any"
            className={inputCls}
            value={soporte}
            onChange={(e) => setSoporte(e.target.value)}
          />
          <p className={errorSoporte ? 'mt-1 text-xs text-red-600' : ayudaCls}>
            {errorSoporte ??
              `La combinación debe aparecer en al menos ${soporteNum}% de las canastas.`}
          </p>
        </div>
        <div>
          <label className={labelCls} htmlFor="apr-confianza">Confianza mínima (%)</label>
          <input
            id="apr-confianza"
            type="number"
            min={0}
            max={100}
            step="any"
            className={inputCls}
            value={confianza}
            onChange={(e) => setConfianza(e.target.value)}
          />
          <p className={errorConfianza ? 'mt-1 text-xs text-red-600' : ayudaCls}>
            {errorConfianza ?? `De quienes compran lo primero, al menos ${confianzaNum}% lleva lo segundo.`}
          </p>
        </div>
        <div>
          <label className={labelCls} htmlFor="apr-tamano">Productos por regla (máx.)</label>
          <select
            id="apr-tamano"
            className={inputCls}
            value={tamanoMaximo}
            onChange={(e) => setTamanoMaximo(Number(e.target.value))}
          >
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
          <p className={ayudaCls}>Con 3: reglas como {'{A, B} → {C}'}.</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label className={labelCls} htmlFor="apr-zona">Zona</label>
          <select id="apr-zona" className={inputCls} value={filtros.zoneId ?? ''} onChange={(e) => cambiarZona(e.target.value)}>
            <option value="">Todas</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>{z.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="apr-tienda">Tienda</label>
          <select
            id="apr-tienda"
            className={inputCls}
            value={filtros.storeId ?? ''}
            onChange={(e) => setFiltros((f) => ({ ...f, storeId: e.target.value || undefined }))}
          >
            <option value="">Todas</option>
            {tiendasDisponibles.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="apr-segmento">Segmento de ingreso</label>
          <select
            id="apr-segmento"
            className={inputCls}
            value={filtros.segmentId ?? ''}
            onChange={(e) =>
              setFiltros((f) => ({ ...f, segmentId: e.target.value ? Number(e.target.value) : undefined }))
            }
          >
            <option value="">Todos</option>
            {segmentos.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="apr-desde">Desde</label>
          <input
            id="apr-desde"
            type="date"
            className={inputCls}
            value={filtros.dateFrom ?? ''}
            onChange={(e) => setFiltros((f) => ({ ...f, dateFrom: e.target.value || undefined }))}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="apr-hasta">Hasta</label>
          <input
            id="apr-hasta"
            type="date"
            className={inputCls}
            value={filtros.dateTo ?? ''}
            onChange={(e) => setFiltros((f) => ({ ...f, dateTo: e.target.value || undefined }))}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-xs text-red-600">
          {fechasInvertidas ? 'La fecha final no puede ser anterior a la inicial.' : error}
        </p>
        <button
          type="submit"
          disabled={invalido || corriendo}
          className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {corriendo ? 'Corriendo…' : 'Correr Apriori'}
        </button>
      </div>
    </form>
  );
}
