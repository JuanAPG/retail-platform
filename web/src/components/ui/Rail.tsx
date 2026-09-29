import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  /** Controlado desde AppShell: el panel lateral de la pantalla reacciona a este mismo estado. */
  expandido: boolean;
  onToggleExpandido: () => void;
}

const PERMISO_TOOLTIP: Partial<Record<NivelPermiso, string>> = {
  lectura: 'lectura',
  propone: 'propone',
  aprueba: 'aprueba',
  lect_act: 'lectura/actualización',
};

/**
 * "expandido" es un concepto de escritorio (el Rail vertical con espacio
 * para el texto). En el bar horizontal de móvil, un botón "expandido"
 * intenta ocupar `w-full` de la fila y se come toda la barra — por eso
 * `expandido` nunca debe llegar a `ModuloBoton` tal cual, sino cruzado con
 * esto (coincide con el breakpoint `lg` de Tailwind, 1024px).
 */
function useEsEscritorio() {
  const [esEscritorio, setEsEscritorio] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const actualizar = () => setEsEscritorio(mq.matches);
    actualizar();
    mq.addEventListener('change', actualizar);
    return () => mq.removeEventListener('change', actualizar);
  }, []);
  return esEscritorio;
}

interface TooltipInfo {
  label: string;
  permiso?: string;
  top: number;
  left: number;
}

function ModuloBoton({
  modulo,
  expandido,
  onHover,
}: {
  modulo: RailModule;
  expandido: boolean;
  onHover: (info: TooltipInfo | null) => void;
}) {
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

  // Colapsado: el nombre del módulo se ve al pasar el mouse. El tooltip lo
  // pinta el Rail en un portal (ver más abajo) — este botón vive dentro de
  // una lista con scroll propio, que recortaría un tooltip absoluto normal.
  function mostrar(e: { currentTarget: HTMLElement }) {
    const rect = e.currentTarget.getBoundingClientRect();
    onHover({ label: modulo.label, permiso: tooltipPermiso, top: rect.top + rect.height / 2, left: rect.right + 12 });
  }
  function ocultar() {
    onHover(null);
  }

  const contenido = (
    <>
      {modulo.icon}
      {typeof modulo.badge === 'number' && modulo.badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border-2 border-teal bg-vino px-1.5 text-[11px] font-bold text-arena">
          {modulo.badge}
        </span>
      )}
    </>
  );

  const className = `relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full transition ${
    modulo.active ? 'bg-vino text-arena' : 'text-arena hover:scale-[1.08] hover:bg-salvia hover:text-tinta'
  }`;

  const eventos = { onMouseEnter: mostrar, onMouseLeave: ocultar, onFocus: mostrar, onBlur: ocultar };

  if (modulo.href) {
    return (
      <Link to={modulo.href} aria-label={modulo.label} className={className} {...eventos}>
        {contenido}
      </Link>
    );
  }

  return (
    <button type="button" onClick={modulo.onClick} aria-label={modulo.label} className={className} {...eventos}>
      {contenido}
    </button>
  );
}

/** DESIGN.md §4/§5 — Rail: navegación de módulos por rol, fija a la altura de la pantalla. */
export function Rail({ modulos, iniciales, perfiles, onLogout, inicioHref = '/', expandido, onToggleExpandido }: RailProps) {
  const esEscritorio = useEsEscritorio();
  const expandidoEfectivo = expandido && esEscritorio;
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left?: number; right?: number; bottom: number } | null>(null);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // El menú de perfiles se pinta con un portal en position: fixed: el Rail
  // vuelve a recortar su contenido a la cápsula redondeada (overflow-hidden
  // más abajo) y un menú absoluto normal quedaría cortado a la mitad.
  useLayoutEffect(() => {
    if (!menuAbierto || !avatarBtnRef.current) return;
    const rect = avatarBtnRef.current.getBoundingClientRect();
    const ancho = 250;
    const cabeAlaIzquierda = rect.left + ancho <= window.innerWidth - 16;
    setMenuPos({
      bottom: window.innerHeight - rect.top + 8,
      ...(cabeAlaIzquierda ? { left: rect.left } : { right: window.innerWidth - rect.right }),
    });
  }, [menuAbierto]);

  useEffect(() => {
    if (!menuAbierto) return;
    function dentroDeAlgo(target: Node) {
      return (avatarBtnRef.current?.contains(target) ?? false) || (menuRef.current?.contains(target) ?? false);
    }
    function alClicFuera(e: MouseEvent) {
      if (!dentroDeAlgo(e.target as Node)) setMenuAbierto(false);
    }
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuAbierto(false);
    }
    function alHacerScroll(e: Event) {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setMenuAbierto(false);
    }
    document.addEventListener('mousedown', alClicFuera);
    document.addEventListener('keydown', alTeclear);
    window.addEventListener('scroll', alHacerScroll, true);
    window.addEventListener('resize', alHacerScroll);
    return () => {
      document.removeEventListener('mousedown', alClicFuera);
      document.removeEventListener('keydown', alTeclear);
      window.removeEventListener('scroll', alHacerScroll, true);
      window.removeEventListener('resize', alHacerScroll);
    };
  }, [menuAbierto]);

  return (
    <nav
      aria-label="Módulos"
      className={`z-[4] flex w-full flex-shrink-0 items-center gap-2.5 overflow-x-auto rounded-panel bg-teal px-4 py-2.5 lg:sticky lg:top-6 lg:h-[calc(100vh-48px)] lg:w-auto lg:flex-col lg:items-center lg:overflow-hidden lg:rounded-[46px] lg:px-0 lg:py-[18px] lg:transition-[width] lg:duration-200 ${
        expandidoEfectivo ? 'lg:w-64 lg:items-stretch lg:px-3.5' : 'lg:w-[92px]'
      }`}
    >
      <div
        className={`flex flex-shrink-0 items-center lg:mb-3.5 ${
          expandidoEfectivo ? 'lg:w-full lg:justify-between lg:gap-2' : 'lg:flex-col lg:gap-1.5'
        }`}
      >
        <Link
          to={inicioHref}
          aria-label="Inicio"
          className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-arena font-display text-[22px] font-extrabold text-teal transition hover:-rotate-12 hover:scale-105 hover:bg-vino hover:text-arena lg:h-[60px] lg:w-[60px]"
        >
          ra
        </Link>
        <button
          type="button"
          onClick={onToggleExpandido}
          aria-label={expandidoEfectivo ? 'Contraer menú' : 'Expandir menú'}
          className="hidden flex-shrink-0 items-center justify-center rounded-full text-arena/70 transition hover:bg-salvia/20 hover:text-arena lg:flex lg:h-8 lg:w-8"
        >
          <IconChevron className={`h-4 w-4 transition-transform ${expandidoEfectivo ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div
        className={`scrollbar-hidden flex flex-1 items-center gap-2.5 lg:min-h-0 lg:flex-col lg:overflow-y-auto lg:py-1 ${
          expandidoEfectivo ? 'lg:items-stretch' : 'lg:items-center'
        }`}
      >
        {modulos.map((modulo) => (
          <ModuloBoton key={modulo.key} modulo={modulo} expandido={expandidoEfectivo} onHover={setTooltip} />
        ))}
      </div>

      <button
        ref={avatarBtnRef}
        type="button"
        onClick={() => setMenuAbierto((v) => !v)}
        aria-label="Perfil"
        aria-haspopup="menu"
        aria-expanded={menuAbierto}
        className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full border-[3px] border-teal bg-salvia text-lg font-bold text-tinta shadow-[0_0_0_2px_#708D81] transition hover:shadow-[0_0_0_4px_#F0ECDF] focus-visible:shadow-[0_0_0_4px_#F0ECDF] lg:h-[60px] ${
          expandidoEfectivo ? 'lg:w-full' : 'lg:w-[60px]'
        }`}
      >
        {iniciales}
      </button>

      {tooltip &&
        !expandidoEfectivo &&
        createPortal(
          <div
            style={{ position: 'fixed', top: tooltip.top, left: tooltip.left, transform: 'translateY(-50%)' }}
            className="pointer-events-none z-[200] flex items-center gap-2 whitespace-nowrap rounded-full bg-tinta px-4 py-2.5 text-[13px] font-semibold text-arena shadow-lift"
          >
            {tooltip.label}
            {tooltip.permiso && <small className="font-medium text-salvia">{tooltip.permiso}</small>}
          </div>,
          document.body,
        )}

      {menuAbierto &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, width: 250 }}
            className="z-[200] flex max-h-[70vh] flex-col gap-1 overflow-y-auto rounded-[30px] bg-tinta p-2.5 shadow-lift"
          >
            {perfiles?.map((perfil) => (
              <Link
                key={perfil.rol}
                to={perfil.href}
                onClick={() => setMenuAbierto(false)}
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
              onClick={() => {
                setMenuAbierto(false);
                onLogout();
              }}
              className="flex items-center gap-2.5 rounded-full px-3.5 py-2.5 text-left text-sm text-arena transition hover:bg-salvia hover:text-tinta"
            >
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-salvia text-tinta">
                <IconCerrarSesion className="h-[15px] w-[15px]" />
              </span>
              Cerrar sesión
            </button>
          </div>,
          document.body,
        )}
    </nav>
  );
}
