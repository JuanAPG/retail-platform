import { FormEvent, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { getZonas } from '../../api/catalogo';
import {
  exportarReporte,
  generarReporteEjecutivo,
  getReporte,
  getReportes,
  IndicadorReporte,
  Reporte,
} from '../../api/documentos';
import { EmptyState } from '../../components/EmptyState';
import { EstadoError } from '../../components/EstadoError';
import { SectionHeader } from '../../components/SectionHeader';
import { Card } from '../../components/ui/Card';
import { CtaButton } from '../../components/ui/CtaButton';
import { ErrorText } from '../../components/ui/ErrorText';
import { StatusPill } from '../../components/ui/StatusPill';
import { listaSegura } from '../../api/seguro';

const GERENTE = 'Gerente de categoría';

const inputClass =
  'h-14 rounded-full border-2 border-transparent bg-arena px-5 text-[15px] text-tinta outline-none transition focus:border-vino focus:bg-marfil hover:border-salvia/60 disabled:opacity-50';
const labelClass = 'flex flex-col gap-1.5 text-[13px] font-semibold text-teal';

function fechaHora(iso: string): string {
  const f = new Date(iso);
  return Number.isNaN(f.getTime()) ? '—' : new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(f);
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Un valor puede ser número, texto, lista u objeto según el indicador. */
function formatearValor(i: IndicadorReporte): string {
  if (!i.disponible) return `No disponible — ${i.motivo ?? 'sin motivo'}`;
  const v = i.valor;
  if (v === null || v === undefined) return 'Sin datos para este periodo';
  if (typeof v === 'number') return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.length === 0 ? 'Sin datos para este periodo' : `${v.length} elemento(s)`;
  return 'Ver detalle';
}

function DetalleValor({ valor }: { valor: unknown }) {
  if (!Array.isArray(valor) && (typeof valor !== 'object' || valor === null)) return null;
  const filas = Array.isArray(valor) ? valor : Object.entries(valor as Record<string, unknown>).map(([k, v]) => ({ [k]: v }));
  if (filas.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1 text-xs text-teal/80">
      {filas.slice(0, 8).map((f, idx) => (
        <li key={idx} className="rounded-full bg-marfil px-3 py-1">
          {Object.entries(f as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${typeof v === 'number' ? new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(v) : String(v ?? '—')}`)
            .join(' · ')}
        </li>
      ))}
      {filas.length > 8 && <li className="px-3 text-teal/60">… y {filas.length - 8} más (completos en el PDF y el Excel)</li>}
    </ul>
  );
}

function DetalleReporte({ reporte, alExportado }: { reporte: Reporte; alExportado: () => void }) {
  const [exportando, setExportando] = useState<'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secciones = listaSegura<IndicadorReporte>(reporte.secciones);
  const noDisponibles = secciones.filter((s) => !s.disponible).length;

  async function exportar(formato: 'pdf' | 'xlsx') {
    setError(null);
    setExportando(formato);
    try {
      await exportarReporte(reporte.id, formato, reporte.creadoEn);
      alExportado();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo exportar el reporte.'));
    } finally {
      setExportando(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={reporte.estado === 'exportado' ? 'ok' : 'neutral'}>
          {reporte.estado === 'exportado' ? 'Exportado' : 'Generado'}
        </StatusPill>
        {noDisponibles > 0 && <StatusPill tone="warn">{`${noDisponibles} indicador(es) no disponible(s)`}</StatusPill>}
        <span className="text-xs text-teal/70">
          {reporte.parametros?.dateFrom ?? '—'} a {reporte.parametros?.dateTo ?? '—'} · {fechaHora(reporte.creadoEn)}
        </span>
      </div>

      {noDisponibles > 0 && (
        <p className="text-xs text-teal/70">
          «No disponible» significa que el servicio dueño del dato no respondió al generar el reporte; no equivale a cero.
          Genera el reporte de nuevo cuando el servicio esté arriba.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {secciones.map((s) => (
          <Card key={s.clave}>
            <span className="text-[13px] font-semibold text-teal">{s.nombre}</span>
            <span className={`font-data text-lg ${s.disponible ? 'text-tinta' : 'text-vino'}`}>{formatearValor(s)}</span>
            <span className="text-[11px] text-teal/60">{s.servicio}</span>
            {s.disponible && <DetalleValor valor={s.valor} />}
          </Card>
        ))}
      </div>

      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex flex-wrap gap-3">
        <CtaButton onClick={() => exportar('pdf')} disabled={exportando !== null}>
          {exportando === 'pdf' ? 'Generando PDF…' : 'Descargar PDF'}
        </CtaButton>
        <CtaButton onClick={() => exportar('xlsx')} disabled={exportando !== null}>
          {exportando === 'xlsx' ? 'Generando Excel…' : 'Descargar Excel'}
        </CtaButton>
      </div>
    </div>
  );
}

/**
 * Reportes ejecutivos (documents-service, D-20). Solo el Gerente de categoría
 * genera; los demás perfiles con acceso consultan y exportan el historial.
 * Si documents-service o su MongoDB caen, el panel lo dice y deja reintentar.
 */
export function ReportesPanel() {
  const { usuario } = useAuth();
  const puedeGenerar = usuario?.rol === GERENTE;

  const historial = useFetch(() => getReportes({ limit: 20 }), []);
  const zonas = useFetch(getZonas, []);
  const filas = listaSegura<Reporte>(historial.data?.data);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState(hoyISO());
  const [zoneId, setZoneId] = useState('');
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccionado, setSeleccionado] = useState<Reporte | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  async function generar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!dateFrom || !dateTo) {
      setError('Indica el periodo del reporte (desde y hasta).');
      return;
    }
    if (dateFrom > dateTo) {
      setError('La fecha «desde» no puede ser posterior a «hasta».');
      return;
    }
    setGenerando(true);
    try {
      const nuevo = await generarReporteEjecutivo({ dateFrom, dateTo, ...(zoneId ? { zoneId } : {}) });
      setSeleccionado(nuevo);
      historial.refetch();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo generar el reporte.'));
    } finally {
      setGenerando(false);
    }
  }

  async function abrir(id: string) {
    setError(null);
    setAbriendo(id);
    try {
      setSeleccionado(await getReporte(id));
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo abrir el reporte.'));
      // Si ya no existe (404) se refresca la lista para que desaparezca.
      historial.refetch();
    } finally {
      setAbriendo(null);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader title="Reportes ejecutivos" description="16 indicadores del análisis comercial, guardados en el historial y exportables." />

      {puedeGenerar && (
        <form noValidate onSubmit={generar} className="flex flex-wrap items-end gap-4 px-6">
          <label className={labelClass}>
            Desde
            <input type="date" className={inputClass} value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className={labelClass}>
            Hasta
            <input type="date" className={inputClass} value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className={labelClass}>
            Zona (opcional)
            <select className={inputClass} value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={zonas.loading}>
              <option value="">Todas las zonas</option>
              {listaSegura<{ id: string; nombre: string }>(zonas.data).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nombre}
                </option>
              ))}
            </select>
          </label>
          <CtaButton type="submit" disabled={generando}>
            {generando ? 'Generando… (puede tardar unos segundos)' : 'Generar reporte'}
          </CtaButton>
        </form>
      )}
      {!puedeGenerar && (
        <p className="px-6 text-sm text-teal/70">Solo el Gerente de categoría genera reportes; aquí puedes consultar y exportar los existentes.</p>
      )}

      {error && (
        <div className="px-6">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      {seleccionado && (
        <div className="px-6">
          <DetalleReporte reporte={seleccionado} alExportado={() => { historial.refetch(); setSeleccionado((s) => (s ? { ...s, estado: 'exportado' } : s)); }} />
        </div>
      )}

      <div className="flex flex-col gap-3 px-6">
        <h2 className="font-display text-2xl text-vino">Historial</h2>
        {historial.loading && <p className="text-sm text-teal/70">Cargando historial…</p>}
        {historial.error && <EstadoError mensaje={historial.error} onReintentar={historial.reintentable ? historial.refetch : undefined} />}
        {historial.data && filas.length === 0 && (
          <EmptyState title="Aún no se ha generado ningún reporte" description="Genera un reporte ejecutivo con los hallazgos del análisis comercial." />
        )}
        {filas.map((r) => (
          <Card key={r.id} onClick={() => abrir(r.id)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-tinta">
                {r.parametros?.dateFrom ?? '—'} a {r.parametros?.dateTo ?? '—'}
              </span>
              <StatusPill tone={r.estado === 'exportado' ? 'ok' : 'neutral'}>{r.estado === 'exportado' ? 'Exportado' : 'Generado'}</StatusPill>
            </div>
            <span className="text-xs text-teal/70">{abriendo === r.id ? 'Abriendo…' : fechaHora(r.creadoEn)}</span>
          </Card>
        ))}
        {historial.data && Number(historial.data.total) > filas.length && (
          <p className="text-xs text-teal/60">Mostrando los {filas.length} más recientes de {historial.data.total}.</p>
        )}
      </div>
    </section>
  );
}
