import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MENU, mensajeAccesoNoPermitido, menuParaRol } from '../config/menu';
import EstadoSesion from './EstadoSesion';

/**
 * Marco de la app: barra lateral con el menú del rol + encabezado con el usuario + el área donde
 * se pinta la pantalla activa. Cada sección muestra qué microservicio la alimenta.
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
        <p>{mensajeAccesoNoPermitido(usuario?.rol ?? 'desconocido')}</p>
        <button onClick={logout}>Cerrar sesión</button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Retail Decision</div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Inicio
          </NavLink>
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={`Servicio: ${item.servicio}`}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div>
            <strong>{usuario?.nombre}</strong>
            <span className="role-badge">{usuario?.rol}</span>
            {actual && <span className="muted servicio-actual">Servicio: {actual.servicio}</span>}
          </div>
          <div className="topbar-right">
            <EstadoSesion />
            <button onClick={logout}>Cerrar sesión</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
