import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { NivelPermiso } from '../Sidebar';
import { IconCerrarSesion } from './icons';

export interface RailModule {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  /** Navegación entre rutas. Si se omite, usar `onClick` (cambia de tab dentro del portal). */
  href?: string;
  onClick?: () => void;
  badge?: number;
  /** Tooltip secundario ("lectura", "aprueba"…), viene de la matriz de permisos. */
  permiso?: NivelPermiso;
}

export interface RailPerfil {
  rol: string;
  iniciales: string;
  href: string;
  actual?: boolean;
}

interface RailProps {
  /** Ya filtrados por rol: un módulo sin acceso no se pasa aquí (DESIGN.md §4). */
  modulos: RailModule[];
  iniciales: string;
  /** Solo Administrador puede recorrer todos los portales sin cerrar sesión. */
  perfiles?: RailPerfil[];
  onLogout: () => void;
  inicioHref?: string;
}

const PERMISO_TOOLTIP: Partial<Record<NivelPermiso, string>> = {
  lectura: 'lectura',
  propone: 'propone',
  aprueba: 'aprueba',
  lect_act: 'lectura/actualización',
};

function ModuloBoton({ modulo }: { modulo: RailModule }) {
  const tooltipPermiso = modulo.permiso ? PERMISO_TOOLTIP[modulo.permiso] : undefined;

  const contenido = (
    <>
      {modulo.icon}
      {typeof modulo.badge === 'number' && modulo.badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border-2 border-teal bg-vino px-1.5 text-[11px] font-bold text-arena">
          {modulo.badge}
        </span>
      )}
      <span className="pointer-events-none absolute left-[68px] top-1/2 z-10 flex -translate-x-2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-tinta px-4 py-2.5 text-[13px] font-semibold text-arena opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100">
        {modulo.label}
        {tooltipPermiso && <small className="font-medium text-salvia">{tooltipPermiso}</small>}
      </span>
    </>
  );

  const className = `group relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full transition ${
    modulo.active ? 'bg-vino text-arena' : 'text-arena hover:scale-[1.08] hover:bg-salvia hover:text-tinta'
  }`;

  if (modulo.href) {
    return (
      <Link to={modulo.href} aria-label={modulo.label} className={className}>
        {contenido}
      </Link>
    );
  }

  return (
    <button type="button" onClick={modulo.onClick} aria-label={modulo.label} className={className}>
      {contenido}
    </button>
  );
}

/** DESIGN.md §4/§5 — Rail: navegación circular de módulos por rol. */
export function Rail({ modulos, iniciales, perfiles, onLogout, inicioHref = '/' }: RailProps) {
  return (
    <nav
      aria-label="Módulos"
      className="relative z-[4] flex w-[92px] flex-shrink-0 flex-col items-center gap-2.5 rounded-[46px] bg-teal py-[18px]"
    >
      <Link
        to={inicioHref}
        aria-label="Inicio"
        className="mb-3.5 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-arena font-display text-[22px] font-extrabold text-teal transition hover:-rotate-12 hover:scale-105 hover:bg-vino hover:text-arena"
      >
        ra
      </Link>

      {modulos.map((modulo) => (
        <ModuloBoton key={modulo.key} modulo={modulo} />
      ))}

      <div className="group/who relative mt-auto">
        <button
          type="button"
          aria-label="Perfil"
          className="flex h-[60px] w-[60px] items-center justify-center rounded-full border-[3px] border-teal bg-salvia text-lg font-bold text-tinta shadow-[0_0_0_2px_#708D81] transition group-hover/who:shadow-[0_0_0_4px_#F0ECDF] group-focus-within/who:shadow-[0_0_0_4px_#F0ECDF]"
        >
          {iniciales}
        </button>
        <div className="invisible absolute bottom-0 left-[72px] flex min-w-[250px] -translate-x-2 flex-col gap-1 rounded-[30px] bg-tinta p-2.5 opacity-0 transition group-hover/who:visible group-hover/who:translate-x-0 group-hover/who:opacity-100 group-focus-within/who:visible group-focus-within/who:translate-x-0 group-focus-within/who:opacity-100">
          {perfiles?.map((perfil) => (
            <Link
              key={perfil.rol}
              to={perfil.href}
              className={`flex items-center gap-2.5 rounded-full px-3.5 py-2.5 text-sm text-arena transition hover:bg-salvia hover:text-tinta ${
                perfil.actual ? 'bg-teal' : ''
              }`}
            >
              <span
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  perfil.actual ? 'bg-vino text-arena' : 'bg-salvia text-tinta'
                }`}
              >
                {perfil.iniciales}
              </span>
              {perfil.rol}
            </Link>
          ))}
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2.5 rounded-full px-3.5 py-2.5 text-left text-sm text-arena transition hover:bg-salvia hover:text-tinta"
          >
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-salvia text-tinta">
              <IconCerrarSesion className="h-[15px] w-[15px]" />
            </span>
            Cerrar sesión
          </button>
        </div>
      </div>
    </nav>
  );
}
