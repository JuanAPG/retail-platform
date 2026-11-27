import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ChartColumn,
  FileText,
  House,
  Layers,
  ListChecks,
  LogOut,
  LucideIcon,
  Map,
  Network,
  Calculator,
  Tag,
  TrendingDown,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { MENU, ROL, mensajeAccesoNoPermitido, menuParaRol } from '../config/menu';
import Aviso from './Aviso';
import EstadoSesion from './EstadoSesion';

/** Ícono de cada sección (solo presentación; quién ve qué sigue en config/menu.ts). */
export const ICONO_SECCION: Record<string, LucideIcon> = {
  '/zonas': Map,
  '/asociacion': Network,
  '/elasticidad': TrendingDown,
  '/segmentos': Layers,
  '/simulacion': Calculator,
  '/ventas': Upload,
  '/promociones': Tag,
  '/seguimiento': ListChecks,
  '/reportes': FileText,
};

/** Color de la insignia del rol. */
const CLASE_ROL: Record<string, string> = {
  [ROL.ANALISTA]: 'rol-analista',
  [ROL.RESPONSABLE_PRECIOS]: 'rol-precios',
  [ROL.PLANEADOR]: 'rol-planeador',
};

/**
 * Marco de la app: barra lateral fija con el menú del rol, encabezado con la sección, el servicio
 * que la alimenta y el usuario, y el área donde se pinta la pantalla activa.
 */
export default function Layout() {
  const { usuario, logout } = useAuth();
  const { pathname } = useLocation();
  const items = menuParaRol(usuario?.rol);
  const actual = MENU.find((m) => m.path === pathname);

  // Defensa extra: AuthContext ya no deja entrar a un perfil fuera de D-31.
  if (items.length === 0) {
    return (
      <div className="acceso-denegado">
        <h1>Acceso no permitido</h1>
        <Aviso tipo="advertencia">{mensajeAccesoNoPermitido(usuario?.rol ?? 'desconocido')}</Aviso>
        <button onClick={logout}>
          <LogOut size={16} aria-hidden="true" />
          Cerrar sesión
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menú principal">
        <div className="sidebar-brand">
          <span className="sidebar-logo" aria-hidden="true">
            <ChartColumn size={20} />
          </span>
          <div>
            <strong>Retail Decision</strong>
            <span>Escritorio de análisis</span>
          </div>
        </div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <House size={18} aria-hidden="true" />
            Inicio
          </NavLink>
          <span className="sidebar-seccion">Secciones</span>
          {items.map((item) => {
            const Icono = ICONO_SECCION[item.path] ?? FileText;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                title={`Servicio: ${item.servicio}`}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                <Icono size={18} aria-hidden="true" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <p className="sidebar-pie">Datos por zona agregada; nunca de personas.</p>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-titulo">
            <strong>{actual?.label ?? 'Inicio'}</strong>
            {actual && (
              <span className="servicio-actual" title={`Servicio: ${actual.servicio}`}>
                {/* Solo los nombres de los servicios; el detalle entre paréntesis queda en el título. */}
                {actual.servicio.replace(/\s*\([^)]*\)/g, '')}
              </span>
            )}
          </div>
          <div className="topbar-right">
            <div className="usuario-info">
              <span className="correo">{usuario?.email}</span>
              <EstadoSesion />
            </div>
            <span className={`role-badge ${CLASE_ROL[usuario?.rol ?? ''] ?? ''}`}>{usuario?.rol}</span>
            <button className="btn-secondary" onClick={logout}>
              <LogOut size={16} aria-hidden="true" />
              Cerrar sesión
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
