import { useState } from 'react';
import { AxiosError } from 'axios';
import { correrApriori } from '../../api/asociacion';
import { mensajeDeError } from '../../api/errores';
import { AnalyticsFilters, AssociationRule, IncomeSegment, Tienda, Zona } from '../../types';
import { IconSimulacion } from '../../components/ui/icons';

const selectClass =
  'h-14 rounded-full border-2 border-transparent bg-arena px-5 text-[15px] text-tinta outline-none transition focus:border-vino focus:bg-marfil hover:border-salvia/60';
const labelClass = 'flex flex-col gap-1.5 text-[13px] font-semibold text-teal';

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
    <form onSubmit={correr} className="flex flex-col gap-4 rounded-panel bg-arena p-6">
      <h2 className="font-slab text-[22px] text-vino">Nueva corrida</h2>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <label className={labelClass} htmlFor="apr-soporte">
          Soporte mínimo (%)
          <input
            id="apr-soporte"
            type="number"
            min={1}
            max={100}
            step="any"
            className={selectClass}
            value={soporte}
            onChange={(e) => setSoporte(e.target.value)}
          />
          <span className={`text-xs ${errorSoporte ? 'font-semibold text-vino' : 'text-teal/70'}`}>
            {errorSoporte ?? `Debe aparecer en al menos ${soporteNum}% de las canastas.`}
          </span>
        </label>
        <label className={labelClass} htmlFor="apr-confianza">
          Confianza mínima (%)
          <input
            id="apr-confianza"
            type="number"
            min={0}
            max={100}
            step="any"
            className={selectClass}
            value={confianza}
            onChange={(e) => setConfianza(e.target.value)}
          />
          <span className={`text-xs ${errorConfianza ? 'font-semibold text-vino' : 'text-teal/70'}`}>
            {errorConfianza ?? `De quienes compran lo primero, ${confianzaNum}% lleva lo segundo.`}
          </span>
        </label>
        <label className={labelClass} htmlFor="apr-tamano">
          Productos por regla (máx.)
          <select id="apr-tamano" className={selectClass} value={tamanoMaximo} onChange={(e) => setTamanoMaximo(Number(e.target.value))}>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
          <span className="text-xs text-teal/70">Con 3: reglas como {'{A, B} → {C}'}.</span>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        <label className={labelClass} htmlFor="apr-zona">
          Zona
          <select id="apr-zona" className={selectClass} value={filtros.zoneId ?? ''} onChange={(e) => cambiarZona(e.target.value)}>
            <option value="">Todas</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>{z.nombre}</option>
            ))}
          </select>
        </label>
        <label className={labelClass} htmlFor="apr-tienda">
          Tienda
          <select
            id="apr-tienda"
            className={selectClass}
            value={filtros.storeId ?? ''}
            onChange={(e) => setFiltros((f) => ({ ...f, storeId: e.target.value || undefined }))}
          >
            <option value="">Todas</option>
            {tiendasDisponibles.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </select>
        </label>
        <label className={labelClass} htmlFor="apr-segmento">
          Segmento de ingreso
          <select
            id="apr-segmento"
            className={selectClass}
            value={filtros.segmentId ?? ''}
            onChange={(e) => setFiltros((f) => ({ ...f, segmentId: e.target.value ? Number(e.target.value) : undefined }))}
          >
            <option value="">Todos</option>
            {segmentos.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className={labelClass} htmlFor="apr-desde">
          Desde
          <input
            id="apr-desde"
            type="date"
            className={selectClass}
            value={filtros.dateFrom ?? ''}
            onChange={(e) => setFiltros((f) => ({ ...f, dateFrom: e.target.value || undefined }))}
          />
        </label>
        <label className={labelClass} htmlFor="apr-hasta">
          Hasta
          <input
            id="apr-hasta"
            type="date"
            className={selectClass}
            value={filtros.dateTo ?? ''}
            onChange={(e) => setFiltros((f) => ({ ...f, dateTo: e.target.value || undefined }))}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold text-vino">{fechasInvertidas ? 'La fecha final no puede ser anterior a la inicial.' : error}</p>
        <button
          type="submit"
          disabled={invalido || corriendo}
          className="flex h-[52px] shrink-0 items-center gap-2.5 rounded-full bg-teal px-6 text-[15px] font-bold text-arena transition hover:bg-vino disabled:opacity-50"
        >
          <IconSimulacion className="h-[18px] w-[18px]" />
          {corriendo ? 'Corriendo…' : 'Correr Apriori'}
        </button>
      </div>
    </form>
  );
}
