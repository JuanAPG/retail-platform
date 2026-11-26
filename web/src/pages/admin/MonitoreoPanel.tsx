import { useCallback, useEffect, useRef, useState } from 'react';
import { esReintentable, mensajeDeError, statusDe } from '../../api/errores';
import { EstadoServicio, getEstadoServicios, getHistorialServicio, PaginaSondeos, SondeoServicio } from '../../api/monitoreo';
import { Cargando } from '../../components/Cargando';
import { EstadoError } from '../../components/EstadoError';
import { SectionHeader } from '../../components/SectionHeader';
import { CtaButton } from '../../components/ui/CtaButton';
import { StatusPill } from '../../components/ui/StatusPill';

/** El monitor sondea cada 30 s (D-44): el panel se refresca al mismo ritmo. */
const REFRESCO_MS = 30_000;
/** Un sondeo con más de 90 s (3 ciclos) ya no describe el estado actual. */
const VIGENCIA_MS = 90_000;

type Vista = EstadoServicio | 'sin_verificar';

const ETIQUETA: Record<Vista, string> = {
  operativo: 'Operativo',
  degradado: 'Degradado',
  caido: 'Caído',
  sin_datos: 'Sin datos',
  sin_verificar: 'Sin verificar',
};

const EXPLICACION: Record<Vista, string> = {
  operativo: 'Responde a tiempo y sus dependencias están bien.',
  degradado: 'Responde, pero una dependencia falla, tardó más de 1 s o tuvo un primer error.',
  caido: 'No respondió en 3 s o falló dos sondeos seguidos.',
  sin_datos: 'El monitor todavía no lo ha sondeado.',
  sin_verificar: 'El último sondeo es de hace más de 90 s: el monitor no lo está verificando.',
};

/** Caído es la alarma (vino); los demás no operativos se distinguen por el texto, nunca solo por color. */
function tono(v: Vista): 'ok' | 'warn' | 'neutral' {
  return v === 'operativo' ? 'ok' : v === 'caido' ? 'warn' : 'neutral';
}

export function vistaDe(s: Pick<SondeoServicio, 'status' | 'checkedAt'>, ahora = Date.now()): Vista {
  if (s.status === 'sin_datos' || !s.checkedAt) return 'sin_datos';
  const edad = ahora - new Date(s.checkedAt).getTime();
  if (!Number.isFinite(edad) || edad > VIGENCIA_MS) return 'sin_verificar';
  return s.status;
}

function hace(iso: string | null, ahora: number): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}

function fechaHora(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso));
}

/** Mensaje del panel según el error: un 403 no se arregla reintentando; un 503 o la red sí. */
function mensajePanel(err: unknown): string {
  const st = statusDe(err);
  if (st === 403) return 'Solo el Administrador puede ver el monitoreo de los servicios.';
  if (st === 503) return 'No se pudo validar tu sesión (Redis no responde). Reintenta en unos segundos.';
  if (st === null) return 'El servicio de monitoreo no responde. Puede estar reiniciando: reintenta en unos segundos.';
  return mensajeDeError(err, 'No se pudo cargar el estado de los servicios.');
}

function Dependencias({ s }: { s: SondeoServicio }) {
  const afectadas = s.dependencies.filter((d) => d.status === 'error' || (d.latencyMs ?? 0) > 1000);
  if (s.dependencies.length === 0) return <span className="text-teal/60">—</span>;
  if (afectadas.length === 0) return <span className="text-teal/70">Todas bien</span>;
  return (
    <span className="text-vino">
      {afectadas.map((d) => `${d.name} (${d.status === 'error' ? 'error' : `${d.latencyMs} ms`})`).join(', ')}
    </span>
  );
}

function Historial({ servicio, onCerrar }: { servicio: string; onCerrar: () => void }) {
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<PaginaSondeos | null>(null);
  const [error, setError] = useState<{ msg: string; reintentable: boolean } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    getHistorialServicio(servicio, pagina, 20)
      .then((d) => vivo && setDatos(d))
      .catch((e) => vivo && setError({ msg: mensajePanel(e), reintentable: esReintentable(e) || statusDe(e) === 503 }))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [servicio, pagina, intento]);

  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.limit)) : 1;
  return (
    <div className="flex flex-col gap-3 rounded-[28px] bg-arena p-4" data-testid="historial-monitoreo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl text-vino">Últimas 24 h · {servicio}</h3>
        <CtaButton onClick={onCerrar}>Cerrar historial</CtaButton>
      </div>
      {cargando && <Cargando etiqueta="Cargando historial…" />}
      {error && <EstadoError mensaje={error.msg} onReintentar={error.reintentable ? () => setIntento((n) => n + 1) : undefined} />}
      {datos && !cargando && datos.data.length === 0 && <p className="text-sm text-teal/70">Sin sondeos en las últimas 24 h.</p>}
      {datos && datos.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="text-[13px] font-semibold text-teal">
                <th className="px-3 py-2">Sondeo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Latencia</th>
                <th className="px-3 py-2 text-right">Errores seguidos</th>
                <th className="px-3 py-2">Dependencias afectadas</th>
              </tr>
            </thead>
            <tbody>
              {datos.data.map((h, i) => (
                <tr key={`${h.checkedAt}-${i}`} className="border-t border-salvia/25 text-tinta">
                  <td className="px-3 py-2 font-data text-xs">{fechaHora(h.checkedAt)}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={tono(h.status)}>{ETIQUETA[h.status]}</StatusPill>
                  </td>
                  <td className="px-3 py-2 text-right font-data">{h.latencyMs != null ? `${h.latencyMs} ms` : '—'}</td>
                  <td className="px-3 py-2 text-right font-data">{h.probeErrorsConsecutive}</td>
                  <td className="px-3 py-2 text-xs">
                    <Dependencias s={h} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && totalPaginas > 1 && (
        <div className="flex items-center gap-3 text-sm text-teal">
          <CtaButton onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1}>
            Más recientes
          </CtaButton>
          <span>
            Página {pagina} de {totalPaginas} · {datos.total} sondeos
          </span>
          <CtaButton onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas}>
            Más antiguos
          </CtaButton>
        </div>
      )}
    </div>
  );
}

/**
 * Monitoreo de los 20 servicios (T-09, D-44). Solo Administrador. Se
 * refresca cada 30 s; si el monitor o la sesión fallan, conserva el último
 * estado conocido y lo marca como desactualizado en vez de vaciar la tabla.
 */
export function MonitoreoPanel() {
  const [servicios, setServicios] = useState<SondeoServicio[] | null>(null);
  const [error, setError] = useState<{ msg: string; reintentable: boolean } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [actualizado, setActualizado] = useState<number | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const datos = await getEstadoServicios();
      if (!vivo.current) return;
      setServicios(datos);
      setError(null);
      setActualizado(Date.now());
    } catch (e) {
      if (vivo.current) setError({ msg: mensajePanel(e), reintentable: statusDe(e) !== 403 });
    } finally {
      if (vivo.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    cargar();
    const t = window.setInterval(cargar, REFRESCO_MS);
    const reloj = window.setInterval(() => setAhora(Date.now()), 5000);
    return () => {
      vivo.current = false;
      window.clearInterval(t);
      window.clearInterval(reloj);
    };
  }, [cargar]);

  const vistas = (servicios ?? []).map((s) => ({ s, v: vistaDe(s, ahora) }));
  const conteo = (v: Vista) => vistas.filter((x) => x.v === v).length;

  return (
    <section className="flex flex-col gap-6" data-testid="panel-monitoreo">
      <SectionHeader title="Monitoreo de servicios" description="Último sondeo de los 20 microservicios cada 30 s e historial de 24 h (monitoring-service)." />

      <div className="flex flex-wrap items-center gap-3 px-6">
        <CtaButton onClick={cargar} disabled={cargando}>
          {cargando ? 'Actualizando…' : 'Actualizar ahora'}
        </CtaButton>
        <span className="text-xs text-teal/70">
          {actualizado ? `Actualizado ${hace(new Date(actualizado).toISOString(), ahora)} · se refresca cada 30 s` : 'Sin datos todavía'}
        </span>
      </div>

      {error && (
        <div className="px-6">
          <EstadoError mensaje={servicios ? `${error.msg} Se muestra el último estado conocido.` : error.msg} onReintentar={error.reintentable ? cargar : undefined} />
        </div>
      )}
      {cargando && !servicios && !error && (
        <div className="px-6">
          <Cargando etiqueta="Consultando el estado de los servicios…" />
        </div>
      )}

      {servicios && (
        <>
          <div className="flex flex-wrap gap-2 px-6" aria-label="Resumen">
            {(['operativo', 'degradado', 'caido', 'sin_verificar', 'sin_datos'] as Vista[]).map((v) => (
              <StatusPill key={v} tone={tono(v)}>{`${ETIQUETA[v]}: ${conteo(v)}`}</StatusPill>
            ))}
          </div>

          <div className="overflow-x-auto px-6">
            <table className="w-full min-w-[820px] text-left text-sm" data-testid="tabla-monitoreo">
              <thead>
                <tr className="text-[13px] font-semibold text-teal">
                  <th className="px-3 py-2">Servicio</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Último sondeo</th>
                  <th className="px-3 py-2">Versión</th>
                  <th className="px-3 py-2 text-right">Latencia</th>
                  <th className="px-3 py-2 text-right">Errores seguidos</th>
                  <th className="px-3 py-2">Dependencias afectadas</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {vistas.map(({ s, v }) => (
                  <tr key={s.service} className="border-t border-salvia/25 text-tinta" data-servicio={s.service} data-estado={v}>
                    <td className="px-3 py-2">
                      <span className="font-semibold">{s.service}</span>
                      <span className="block font-data text-[11px] text-teal/60">:{s.port}</span>
                    </td>
                    <td className="px-3 py-2" title={EXPLICACION[v]}>
                      <StatusPill tone={tono(v)}>{ETIQUETA[v]}</StatusPill>
                    </td>
                    <td className="px-3 py-2 text-xs" title={fechaHora(s.checkedAt)}>
                      {hace(s.checkedAt, ahora)}
                    </td>
                    <td className="px-3 py-2 font-data text-xs">{s.version ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-data">{s.latencyMs != null ? `${s.latencyMs} ms` : '—'}</td>
                    <td className="px-3 py-2 text-right font-data">{s.probeErrorsConsecutive}</td>
                    <td className="px-3 py-2 text-xs">
                      <Dependencias s={s} />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-xs font-semibold text-vino underline-offset-2 hover:underline"
                        onClick={() => setSeleccionado(s.service)}
                        aria-label={`Historial de ${s.service}`}
                      >
                        Historial
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="grid grid-cols-1 gap-1 px-6 text-xs text-teal/70 md:grid-cols-2">
            {(['operativo', 'degradado', 'caido', 'sin_verificar', 'sin_datos'] as Vista[]).map((v) => (
              <div key={v}>
                <dt className="inline font-semibold">{ETIQUETA[v]}: </dt>
                <dd className="inline">{EXPLICACION[v]}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {seleccionado && (
        <div className="px-6">
          <Historial servicio={seleccionado} onCerrar={() => setSeleccionado(null)} />
        </div>
      )}
    </section>
  );
}
