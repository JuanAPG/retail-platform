import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { menuParaRol } from '../config/menu';
import EstadoSesion from './EstadoSesion';

/**
 * Marco de la app: barra lateral con el menú del rol + encabezado con el
 * usuario + el área donde se pinta la pantalla activa (<Outlet />).
 */
export default function Layout() {
  const { usuario, logout } = useAuth();
  const items = menuParaRol(usuario?.rol ?? null);

  // Un rol sin secciones (ej. Proveedor) no debe ver la app, solo este aviso.
  if (items.length === 0) {
    return (
      <div className="acceso-denegado">
        <h1>Sin acceso a esta aplicación</h1>
        <p>
          Tu perfil ({usuario?.rol ?? 'desconocido'}) no tiene secciones disponibles en la aplicación de
          escritorio de análisis.
        </p>
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