import { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import RoleRoute from './components/RoleRoute';
import Login from './pages/Login';
import Home from './pages/Home';
import SeccionPendiente from './pages/SeccionPendiente';
import Zonas from './pages/Zonas';
import Asociacion from './pages/Asociacion';
import { MENU, MenuItem } from './config/menu';
import Segmentos from './pages/Segmentos';

/** Exige sesión iniciada; si no, manda a /login. */
function PrivateRoute({ children }: { children: ReactElement }) {
  const { isLoggedIn, isLoading } = useAuth();
  if (isLoading) return <p style={{ padding: 24 }}>Cargando sesión...</p>;
  return isLoggedIn ? children : <Navigate to="/login" replace />;
}

function seccion(path: string): MenuItem {
  return MENU.find((m) => m.path === path)!;
}

/**
 * Ruta protegida por rol. Si la sección ya tiene pantalla real se pasa como
 * `pantalla`; si no, muestra la pantalla pendiente.
 */
function rutaSeccion(path: string, pantalla?: ReactElement) {
  const item = seccion(path);
  return (
    <Route
      path={item.path.slice(1)}
      element={
        <RoleRoute roles={item.roles}>
          {pantalla ?? (
            <SeccionPendiente titulo={item.label} descripcion={item.description} servicio={item.servicio} />
          )}
        </RoleRoute>
      }
    />
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Home />} />
        {rutaSeccion('/zonas', <Zonas />)}
        {rutaSeccion('/asociacion', <Asociacion />)}
        {rutaSeccion('/elasticidad')}
        {rutaSeccion('/segmentos', <Segmentos />)}
        {rutaSeccion('/ventas')}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}