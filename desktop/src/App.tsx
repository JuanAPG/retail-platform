import { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import RoleRoute from './components/RoleRoute';
import Login from './pages/Login';
import Home from './pages/Home';
import Zonas from './pages/Zonas';
import Asociacion from './pages/Asociacion';
import Elasticidad from './pages/Elasticidad';
import Segmentos from './pages/Segmentos';
import Simulacion from './pages/Simulacion';
import Ventas from './pages/Ventas';
import Reportes from './pages/Reportes';

/** Exige sesión iniciada; si no, manda a /login. */
function PrivateRoute({ children }: { children: ReactElement }) {
  const { isLoggedIn, isLoading } = useAuth();
  if (isLoading) return <p style={{ padding: 24 }}>Cargando sesión...</p>;
  return isLoggedIn ? children : <Navigate to="/login" replace />;
}

/** Ruta protegida por rol: la misma regla que el menú (config/menu.ts). */
function rutaSeccion(path: string, pantalla: ReactElement) {
  return <Route path={path.slice(1)} element={<RoleRoute path={path}>{pantalla}</RoleRoute>} />;
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
        {rutaSeccion('/elasticidad', <Elasticidad />)}
        {rutaSeccion('/segmentos', <Segmentos />)}
        {rutaSeccion('/simulacion', <Simulacion />)}
        {rutaSeccion('/ventas', <Ventas />)}
        {rutaSeccion('/reportes', <Reportes />)}
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