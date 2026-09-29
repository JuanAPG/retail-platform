import { ReactNode, useEffect, useState } from 'react';
import { Header } from './Header';
import { Rail, RailModule, RailPerfil } from './Rail';

interface AppShellProps {
  rolLabel: string;
  nombre: string;
  modulos: RailModule[];
  iniciales: string;
  perfiles?: RailPerfil[];
  onLogout: () => void;
  buscador?: { placeholder: string; value: string; onChange: (valor: string) => void };
  onNotificaciones?: () => void;
  notificacionesPendientes?: boolean;
  /** Columna central: hero + chips/tarjetas de la pantalla. */
  children: ReactNode;
  /** Columna derecha (364–400px): tarjetas, colas, detalle. */
  aside?: ReactNode;
}

const CLAVE_EXPANDIDO = 'rail-expandido';

/**
 * DESIGN.md §4 — Layout base: Rail + Header + columna central + aside.
 *
 * El Rail expandido y la columna aside compiten por el mismo ancho: con las
 * dos abiertas a la vez, el contenido central se aprieta tanto que los
 * decorados del Hero terminan encimados con el texto. Por eso el estado de
 * "expandido" vive aquí (no dentro de Rail) y se usa también para ocultar
 * el aside mientras el Rail esté expandido.
 */
export function AppShell({
  rolLabel,
  nombre,
  modulos,
  iniciales,
  perfiles,
  onLogout,
  buscador,
  onNotificaciones,
  notificacionesPendientes,
  children,
  aside,
}: AppShellProps) {
  const [expandido, setExpandido] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_EXPANDIDO) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_EXPANDIDO, expandido ? '1' : '0');
    } catch {
      // Almacenamiento no disponible (modo privado, etc.): la preferencia solo dura la sesión.
    }
  }, [expandido]);

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-marfil p-4 sm:p-6 lg:flex-row">
      <Rail
        modulos={modulos}
        iniciales={iniciales}
        perfiles={perfiles}
        onLogout={onLogout}
        expandido={expandido}
        onToggleExpandido={() => setExpandido((v) => !v)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Header
          rolLabel={rolLabel}
          nombre={nombre}
          buscador={buscador}
          onNotificaciones={onNotificaciones}
          notificacionesPendientes={notificacionesPendientes}
        />
        <div className="flex min-h-0 flex-1 flex-col gap-6 xl:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
          {aside && (
            <aside
              className={`flex flex-col gap-6 xl:overflow-hidden xl:transition-[width,opacity] xl:duration-200 ${
                expandido ? 'xl:w-0 xl:opacity-0' : 'xl:w-96 xl:flex-shrink-0 xl:opacity-100'
              }`}
              aria-hidden={expandido}
            >
              <div className="flex w-full flex-col gap-6 xl:w-96 xl:flex-shrink-0">{aside}</div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
