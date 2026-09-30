import { useFetch } from '../../hooks/useFetch';
import { ErrorText } from '../../components/ui/ErrorText';
import { IconCheck, IconResultados } from '../../components/ui/icons';
import { getEscenarios } from '../../api/simulacion';
import { Zona } from '../../types';

const formatoFecha = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

interface Props {
  zonas: Zona[];
  seleccionados: string[];
  onCambiarSeleccion: (ids: string[]) => void;
  onVerResultados: () => void;
}

/** M13 — Historial de escenarios guardados; de aquí se eligen 2+ para comparar en Resultados. */
export function HistorialSimulacionesPanel({ zonas, seleccionados, onCambiarSeleccion, onVerResultados }: Props) {
  const escenarios = useFetch(getEscenarios, []);
  const lista = escenarios.data ?? [];

  function alternar(id: string) {
    onCambiarSeleccion(seleccionados.includes(id) ? seleccionados.filter((s) => s !== id) : [...seleccionados, id]);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl text-vino">Historial</h1>
        {seleccionados.length >= 2 && (
          <button
            type="button"
            onClick={onVerResultados}
            className="flex h-11 items-center rounded-full bg-vino px-5 text-sm font-bold text-arena transition hover:bg-teal"
          >
            Comparar {seleccionados.length} seleccionados
          </button>
        )}
      </div>

      {escenarios.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {escenarios.error && <ErrorText>{escenarios.error}</ErrorText>}

      {escenarios.data && lista.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconResultados className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">Aún no has ejecutado ninguna simulación</p>
          <p className="max-w-md text-sm text-teal/70">Las simulaciones que ejecutes aparecerán aquí con su fecha y resultado.</p>
        </div>
      )}

      {lista.length > 0 && (
        <>
          <p className="px-1 text-xs text-teal/60">Selecciona 2 o más para compararlos en Resultados.</p>
          <div className="flex flex-col gap-2">
            {lista.map((esc) => {
              const elegido = seleccionados.includes(esc.id);
              return (
                <button
                  key={esc.id}
                  type="button"
                  onClick={() => alternar(esc.id)}
                  className={`flex items-center gap-3.5 rounded-full p-2 pr-4 text-left transition hover:translate-x-1 ${
                    elegido ? 'bg-teal text-arena' : 'bg-arena text-tinta'
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                      elegido ? 'bg-vino text-arena' : 'bg-salvia/40 text-teal'
                    }`}
                  >
                    {elegido && <IconCheck className="h-4 w-4" />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-bold">{esc.nombre}</span>
                    <span className={`font-data text-xs ${elegido ? 'text-salvia' : 'text-teal/70'}`}>
                      {esc.zonaId ? zonas.find((z) => z.id === esc.zonaId)?.nombre ?? 'Zona' : 'Nacional'} · {formatoFecha.format(new Date(esc.createdAt))}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
