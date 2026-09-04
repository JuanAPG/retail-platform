import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { portalDelRol } from './routes/portalPorRol';
import { PantallaCargando } from './components/PantallaCargando';
import { LoginPage } from './pages/LoginPage';
import { RegisterProveedorPage } from './pages/RegisterProveedorPage';
import { AdminPortal } from './pages/AdminPortal';
import { CatalogoPortal } from './pages/CatalogoPortal';
import { AnalistaPortal } from './pages/AnalistaPortal';
import { AuditorPortal } from './pages/AuditorPortal';
import { PlaneadorPortal } from './pages/PlaneadorPortal';
import { ProveedorPortal } from './pages/ProveedorPortal';
import { NotAuthorizedPage } from './pages/NotAuthorizedPage';

function RaizAutenticada() {
  const { usuario, isAuthenticated } = useAuth();
  if (!isAuthenticated || !usuario) return <Navigate to="/login" replace />;
  return <Navigate to={portalDelRol(usuario.rol)} replace />;
}

function AppRoutes() {
  const { cargandoSesion } = useAuth();

  // Hasta que /auth/me confirme (o descarte) la sesión guardada no se
  // pintan las rutas: si no, al recargar /admin el ProtectedRoute vería
  // `usuario === null` por un instante y patearía al login a un usuario
  // con sesión perfectamente válida.
  if (cargandoSesion) {
    return <PantallaCargando />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registro-proveedor" element={<RegisterProveedorPage />} />
      <Route path="/no-autorizado" element={<NotAuthorizedPage />} />

      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['Administrador']}>
            <AdminPortal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/catalogo"
        element={
          <ProtectedRoute allowedRoles={['Gerente de categoría', 'Responsable de precios']}>
            <CatalogoPortal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analista"
        element={
          <ProtectedRoute allowedRoles={['Analista comercial']}>
            <AnalistaPortal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/auditor"
        element={
          <ProtectedRoute allowedRoles={['Auditor']}>
            <AuditorPortal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/planeador"
        element={
          <ProtectedRoute allowedRoles={['Planeador']}>
            <PlaneadorPortal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/proveedor"
        element={
          <ProtectedRoute allowedRoles={['Proveedor']}>
            <ProveedorPortal />
          </ProtectedRoute>
        }
      />

      <Route path="/" element={<RaizAutenticada />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
