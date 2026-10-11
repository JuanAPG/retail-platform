import { useCallback, useEffect, useState } from 'react';
import { getNoLeidas, getNotificaciones, marcarLeida, Notificacion } from '../api/notificaciones';
import { IconCampana } from './ui/icons';

const REFRESCO_MS = 60000;

function fechaCorta(iso: string): string {
  const f = new Date(iso);
  return Number.isNaN(f.getTime()) ? '' : new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(f);
}

/**
 * Campana del header (notifications-service). Un fallo del servicio NO debe
 * romper la pantalla: la campana se queda sin contador y el panel dice que
 * no pudo cargar.
 */
export function CampanaNotificaciones({ userId }: { userId: string }) {
  const [abierta, setAbierta] = useState(false);
  const [noLeidas, setNoLeidas] = useState(0);
  const [lista, setLista] = useState<Notificacion[] | null>(null);
  const [error, setError] = useState(false);

  const contar = useCallback(() => {
    getNoLeidas().then(setNoLeidas).catch(() => undefined);
  }, []);

  useEffect(() => {
    contar();
    const t = window.setInterval(contar, REFRESCO_MS);
    return () => window.clearInterval(t);
  }, [contar]);

  function alternar() {
    const nueva = !abierta;
    setAbierta(nueva);
    if (!nueva) return;
    setError(false);
    getNotificaciones(10)
      .then((p) => setLista(p.data))
      .catch(() => setError(true));
  }

  async function leer(n: Notificacion) {
    try {
      await marcarLeida(n.id);
      setLista(
        (l) =>
          l?.map((x) => (x.id === n.id ? { ...x, readBy: [...x.readBy, { userId, readAt: new Date().toISOString() }] } : x)) ??
          null,
      );
      contar();
    } catch {
      // Sin red o ya no existe: el contador se corrige en el siguiente refresco.
    }
  }

  const leida = (n: Notificacion) => n.readBy.some((r) => r.userId === userId);

  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={alternar}
        aria-label={noLeidas > 0 ? `Notificaciones (${noLeidas} sin leer)` : 'Notificaciones'}
        aria-expanded={abierta}
        className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-arena text-teal transition hover:-rotate-[8deg] hover:bg-teal hover:text-arena"
      >
        <IconCampana />
        {noLeidas > 0 && (
          <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-vino px-1 text-[11px] font-bold text-arena">
            {noLeidas > 99 ? '99+' : noLeidas}
          </span>
        )}
      </button>

      {abierta && (
        <div className="absolute right-0 z-40 mt-2 flex max-h-[70vh] w-[min(92vw,380px)] flex-col gap-2 overflow-y-auto rounded-[28px] border-2 border-salvia bg-marfil p-3 shadow-lift">
          {error && <p className="p-3 text-sm text-vino">No se pudieron cargar las notificaciones. Intenta de nuevo en un momento.</p>}
          {!error && lista === null && <p className="p-3 text-sm text-teal/70">Cargando…</p>}
          {!error && lista?.length === 0 && <p className="p-3 text-sm text-teal/70">No tienes notificaciones.</p>}
          {lista?.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => !leida(n) && leer(n)}
              className={`rounded-[20px] px-4 py-3 text-left text-sm ${leida(n) ? 'bg-arena/50 text-teal/70' : 'bg-arena font-semibold text-tinta'}`}
            >
              <span className="block">{n.title}</span>
              <span className="block text-xs font-normal opacity-80">{n.message}</span>
              <span className="mt-1 block text-[11px] font-normal opacity-60">{fechaCorta(n.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
