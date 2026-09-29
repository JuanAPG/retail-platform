import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { NivelPermiso } from '../Sidebar';
import { IconCerrarSesion, IconChevron } from './icons';

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

const CLAVE_EXPANDIDO = 'rail-expandido';

function ModuloBoton({ modulo, expandido }: { modulo: RailModule; expandido: boolean }) {
  const tooltipPermiso = modulo.permiso ? PERMISO_TOOLTIP[modulo.permiso] : undefined;

  if (expandido) {
    const className = `flex h-14 w-full flex-shrink-0 items-center gap-3 rounded-full px-4 transition ${
      modulo.active ? 'bg-vino text-arena' : 'text-arena hover:bg-salvia hover:text-tinta'
    }`;
    const contenido = (
      <>
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center">{modulo.icon}</span>
        <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">{modulo.label}</span>
        {tooltipPermiso && <small className="flex-shrink-0 font-medium text-salvia">{tooltipPermiso}</small>}
        {typeof modulo.badge === 'number' && modulo.badge > 0 && (
          <span className="flex h-[22px] min-w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-arena px-1.5 text-[11px] font-bold text-vino">
            {modulo.badge}
          </span>
        )}
      </>
    );
    return modulo.href ? (
      <Link to={modulo.href} aria-label={modulo.label} className={className}>
        {contenido}
      </Link>
    ) : (
      <button type="button" onClick={modulo.onClick} aria-label={modulo.label} className={className}>
        {contenido}
      </button>
    );
  }

  const contenido = (
    <>
      {modulo.icon}
      {typeof modulo.badge === 'number' && modulo.badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border-2 border-teal bg-vino px-1.5 text-[11px] font-bold text-arena">
          {modulo.badge}
        </span>
      )}
      <span className="pointer-events-none absolute left-[68px] top-1/2 z-10 hidden -translate-x-2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-tinta px-4 py-2.5 text-[13px] font-semibold text-arena opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100 lg:flex">
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

/** DESIGN.md §4/§5 — Rail: navegación de módulos por rol, fija a la altura de la pantalla. */
export function Rail({ modulos, iniciales, perfiles, onLogout, inicioHref = '/' }: RailProps) {
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
    <nav
      aria-label="Módulos"
      className={`z-[4] flex w-full flex-shrink-0 items-center gap-2.5 overflow-x-auto rounded-panel bg-teal px-4 py-2.5 lg:sticky lg:top-6 lg:h-[calc(100vh-48px)] lg:w-auto lg:flex-col lg:items-center lg:overflow-x-visible lg:overflow-y-auto lg:rounded-[46px] lg:px-0 lg:py-[18px] lg:transition-[width] lg:duration-200 ${
        expandido ? 'lg:w-64 lg:items-stretch lg:px-3.5' : 'lg:w-[92px]'
      }`}
    >
      <Link
        to={inicioHref}
        aria-label="Inicio"
        className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-arena font-display text-[22px] font-extrabold text-teal transition hover:-rotate-12 hover:scale-105 hover:bg-vino hover:text-arena lg:mb-3.5 lg:h-[60px] ${
          expandido ? 'lg:w-full' : 'lg:w-[60px]'
        }`}
      >
        ra
      </Link>

      <div className={`flex flex-1 items-center gap-2.5 lg:flex-col ${expandido ? 'lg:items-stretch' : 'lg:items-center'}`}>
        {modulos.map((modulo) => (
          <ModuloBoton key={modulo.key} modulo={modulo} expandido={expandido} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setExpandido((v) => !v)}
        aria-label={expandido ? 'Contraer menú' : 'Expandir menú'}
        className={`hidden flex-shrink-0 items-center justify-center gap-2 rounded-full text-arena/70 transition hover:bg-salvia/20 hover:text-arena lg:flex lg:h-11 ${
          expandido ? 'lg:w-full' : 'lg:w-11'
        }`}
      >
        <IconChevron className={`h-4 w-4 transition-transform ${expandido ? '-rotate-180' : ''}`} />
        {expandido && <span className="text-xs font-semibold">Contraer</span>}
      </button>

      {/* pr-4 puentea el hueco entre el avatar y el menú con un div
          invisible aparte: si el padding fuera parte de este contenedor,
          desalinearía el avatar respecto a los demás íconos (quedaría
          recorrido a la izquierda). */}
      <div className={`group/who relative flex-shrink-0 ${expandido ? 'lg:w-full' : ''}`}>
        <button
          type="button"
          aria-label="Perfil"
          className={`relative z-[1] flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-teal bg-salvia text-lg font-bold text-tinta shadow-[0_0_0_2px_#708D81] transition group-hover/who:shadow-[0_0_0_4px_#F0ECDF] group-focus-within/who:shadow-[0_0_0_4px_#F0ECDF] lg:h-[60px] ${
            expandido ? 'lg:w-full lg:gap-3 lg:px-1' : 'lg:w-[60px]'
          }`}
        >
          {iniciales}
        </button>
        {!expandido && <div className="absolute left-full top-0 hidden h-full w-4 lg:block" aria-hidden="true" />}
        <div
          className={`invisible absolute bottom-[calc(100%+8px)] right-0 z-10 flex min-w-[250px] translate-y-2 flex-col gap-1 rounded-[30px] bg-tinta p-2.5 opacity-0 transition group-hover/who:visible group-hover/who:translate-x-0 group-hover/who:translate-y-0 group-hover/who:opacity-100 group-focus-within/who:visible group-focus-within/who:translate-x-0 group-focus-within/who:translate-y-0 group-focus-within/who:opacity-100 ${
            expandido
              ? 'lg:bottom-[calc(100%+8px)] lg:left-0 lg:right-0 lg:translate-y-2 lg:translate-x-0'
              : 'lg:bottom-0 lg:left-[72px] lg:right-auto lg:top-auto lg:-translate-x-2 lg:translate-y-0'
          }`}
        >
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
