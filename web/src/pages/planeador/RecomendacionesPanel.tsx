import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { StatusPill } from '../../components/ui/StatusPill';
import { ErrorText } from '../../components/ui/ErrorText';
import { IconChevron, IconRecomendaciones } from '../../components/ui/icons';
import { mensajeDeError } from '../../api/errores';
import {
  explicarRecomendacion,
  ExplicacionRecomendacion,
  generarRecomendaciones,
  Recomendacion,
} from '../../api/recomendaciones';
import { Zona } from '../../types';

interface Props {
  zonas: Zona[];
  /** Solo Administrador y Analista comercial pueden generar (mismo criterio que M10/M11/M13). */
  puedeGenerar: boolean;
}

/**
 * M14 — El contrato solo expone "generar" y "explicar una ya generada"
 * (no hay listado general): por eso lo que se ve aquí es el lote recién
 * generado en esta sesión, no un historial persistente entre recargas.
 */
export function RecomendacionesPanel({ zonas, puedeGenerar }: Props) {
  const [zonaId, setZonaId] = useState('');
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recomendaciones, setRecomendaciones] = useState<Recomendacion[] | null>(null);
  const [expandidaId, setExpandidaId] = useState<string | null>(null);
  const [explicacion, setExplicacion] = useState<ExplicacionRecomendacion | null>(null);
  const [cargandoExplicacion, setCargandoExplicacion] = useState(false);

  async function generar() {
    setError(null);
    setGenerando(true);
    try {
      const r = await generarRecomendaciones(zonaId || undefined);
      setRecomendaciones(r);
      setExpandidaId(null);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron generar las recomendaciones.'));
    } finally {
      setGenerando(false);
    }
  }

  async function alternarExplicacion(id: string) {
    if (expandidaId === id) {
      setExpandidaId(null);
      return;
    }
    setExpandidaId(id);
    setExplicacion(null);
    setCargandoExplicacion(true);
    try {
      setExplicacion(await explicarRecomendacion(id));
    } catch {
      setExplicacion(null);
    } finally {
      setCargandoExplicacion(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-4xl text-vino">Recomendaciones</h1>
        <StatusPill tone="neutral">{recomendaciones?.length ?? 0}</StatusPill>
      </div>

      {!puedeGenerar && (
        <div className="rounded-full bg-vino/10 px-5 py-3">
          <p className="text-sm font-semibold text-vino">
            Solo Administrador o Analista comercial pueden generar recomendaciones. Pide que generen un lote y
            compártelo contigo.
          </p>
        </div>
      )}

      {puedeGenerar && (
        <div className="flex flex-wrap items-end gap-3.5 rounded-panel bg-arena p-6">
          <div className="max-w-xs flex-1">
            <Select id="rec-zona" label="Zona (opcional)" value={zonaId} onChange={(e) => setZonaId(e.target.value)} placeholder="Todas las zonas con datos">
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>{z.nombre}</option>
              ))}
            </Select>
          </div>
          <button
            type="button"
            onClick={generar}
            disabled={generando}
            className="flex h-[52px] shrink-0 items-center rounded-full bg-teal px-6 text-[15px] font-bold text-arena transition hover:bg-vino disabled:opacity-50"
          >
            {generando ? 'Generando…' : 'Generar recomendaciones'}
          </button>
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {recomendaciones === null && !error && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconRecomendaciones className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">Aún no hay recomendaciones generadas</p>
          <p className="max-w-md text-sm text-teal/70">
            Cada recomendación explica qué se sugiere, por qué, con qué datos se generó y qué impacto estima.
          </p>
        </div>
      )}

      {recomendaciones && recomendaciones.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <p className="font-display text-xl text-teal">No se encontró nada que recomendar con los datos actuales</p>
        </div>
      )}

      {recomendaciones && recomendaciones.length > 0 && (
        <div className="flex flex-col gap-2">
          {recomendaciones.map((r) => {
            const abierta = expandidaId === r.id;
            return (
              <div key={r.id} className="flex flex-col gap-2 rounded-panel bg-arena p-5">
                <button type="button" onClick={() => alternarExplicacion(r.id)} className="flex items-center justify-between gap-3 text-left">
                  <span className="font-display text-lg text-tinta">{r.titulo}</span>
                  <IconChevron className={`h-4 w-4 flex-shrink-0 text-teal transition-transform ${abierta ? '-rotate-90' : 'rotate-90'}`} />
                </button>
                <p className="text-sm text-teal">{r.queRecomienda}</p>
                {abierta && (
                  <div className="flex flex-col gap-2 border-t border-salvia/25 pt-3 text-sm">
                    {cargandoExplicacion && <p className="text-teal/70">Cargando…</p>}
                    {!cargandoExplicacion && explicacion && (
                      <>
                        <p><span className="font-semibold text-tinta">Por qué: </span><span className="text-teal">{explicacion.why}</span></p>
                        <p><span className="font-semibold text-tinta">Impacto estimado: </span><span className="text-teal">{explicacion.estimatedImpact}</span></p>
                        {explicacion.evidence.length > 0 && (
                          <ul className="flex flex-col gap-1 pl-4">
                            {explicacion.evidence.map((ev, i) => (
                              <li key={i} className="list-disc font-data text-xs text-teal/70">{ev.description}</li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
