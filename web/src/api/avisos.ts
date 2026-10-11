/**
 * Bus mínimo de avisos globales: el cliente HTTP (que no es un componente)
 * avisa de caídas y de 403, y `AvisosGlobales` los pinta. Se usa un evento del
 * `window` para no acoplar la capa de red con React.
 */
export type ClaseAviso = 'red' | 'timeout' | 'servidor' | 'no-disponible' | 'prohibido';

export interface Aviso {
  servicio: string;
  clase: ClaseAviso;
}

const EVENTO = 'api:aviso';
const VENTANA_MS = 4000;
const ultimos = new Map<string, number>();

export function emitirAviso(aviso: Aviso): void {
  // El mismo servicio con la misma falla no repite el aviso en 4 s: una
  // pantalla con 6 paneles caídos no debe abrir 6 toasts.
  const clave = `${aviso.servicio}:${aviso.clase}`;
  const ahora = Date.now();
  if (ahora - (ultimos.get(clave) ?? 0) < VENTANA_MS) return;
  ultimos.set(clave, ahora);
  window.dispatchEvent(new CustomEvent<Aviso>(EVENTO, { detail: aviso }));
}

export function escucharAvisos(manejador: (aviso: Aviso) => void): () => void {
  const alvo = (e: Event) => manejador((e as CustomEvent<Aviso>).detail);
  window.addEventListener(EVENTO, alvo);
  return () => window.removeEventListener(EVENTO, alvo);
}

export function textoDeAviso({ servicio, clase }: Aviso): string {
  switch (clase) {
    case 'red':
      return `No se pudo conectar con ${servicio}. Revisa tu conexión o que el servicio esté encendido.`;
    case 'timeout':
      return `${servicio} tardó demasiado en responder. Intenta de nuevo en un momento.`;
    case 'no-disponible':
      return `${servicio} no está disponible por ahora (503). Intenta de nuevo en unos minutos.`;
    case 'prohibido':
      return `Tu rol no tiene permiso para esta acción en ${servicio}.`;
    default:
      return `${servicio} tuvo un error interno. Si persiste, avisa al equipo.`;
  }
}
