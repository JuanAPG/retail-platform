import { ReactNode } from 'react';
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

/**
 * DESIGN.md §4 — Layout base: Rail + Header + columna central + aside.
 * Listo para usarse cuando cada portal se rediseñe; no está conectado a
 * `ProtectedRoute` todavía para no duplicar la barra vieja (TopBar +
 * Sidebar) mientras un portal no le toque su turno.
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
  return (
    <div className="flex min-h-screen flex-col gap-6 bg-marfil p-4 sm:p-6 lg:flex-row">
      <Rail modulos={modulos} iniciales={iniciales} perfiles={perfiles} onLogout={onLogout} />
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
          {aside && <aside className="flex flex-col gap-6 xl:w-96 xl:flex-shrink-0">{aside}</aside>}
        </div>
      </div>
    </div>
  );
}
