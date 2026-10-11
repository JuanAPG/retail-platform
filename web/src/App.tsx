import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { portalDelRol } from './routes/portalPorRol';
import { PantallaCargando } from './components/PantallaCargando';
import { LoginPage } from './pages/LoginPage';
import { RegisterProveedorPage } from './pages/RegisterProveedorPage';
const AdminPortal = lazy(() => import('./pages/AdminPortal').then((m) => ({ default: m.AdminPortal })));
const CatalogoPortal = lazy(() => import('./pages/CatalogoPortal').then((m) => ({ default: m.CatalogoPortal })));
const AnalistaPortal = lazy(() => import('./pages/AnalistaPortal').then((m) => ({ default: m.AnalistaPortal })));
const AuditorPortal = lazy(() => import('./pages/AuditorPortal').then((m) => ({ default: m.AuditorPortal })));
const PlaneadorPortal = lazy(() => import('./pages/PlaneadorPortal').then((m) => ({ default: m.PlaneadorPortal })));
const ProveedorPortal = lazy(() => import('./pages/ProveedorPortal').then((m) => ({ default: m.ProveedorPortal })));
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
    <Suspense fallback={<PantallaCargando />}>
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
          <ProtectedRoute allowedRoles={['Administrador', 'Gerente de categoría', 'Responsable de precios']}>
            <CatalogoPortal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analista"
        element={
          <ProtectedRoute allowedRoles={['Administrador', 'Analista comercial']}>
            <AnalistaPortal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/auditor"
        element={
          <ProtectedRoute allowedRoles={['Administrador', 'Auditor']}>
            <AuditorPortal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/planeador"
        element={
          <ProtectedRoute allowedRoles={['Administrador', 'Planeador']}>
            <PlaneadorPortal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/proveedor"
        element={
          <ProtectedRoute allowedRoles={['Administrador', 'Proveedor']}>
            <ProveedorPortal />
          </ProtectedRoute>
        }
      />

      <Route path="/" element={<RaizAutenticada />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
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
