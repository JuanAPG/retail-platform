import { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Protege una ruta por rol. Ocultar el botón del menú no basta: alguien
 * podría llegar a la ruta directo, así que cada pantalla se envuelve aquí
 * con la lista de roles permitidos (la misma que usa el menú).
 */
export default function RoleRoute({ roles, children }: { roles: readonly string[]; children: ReactElement }) {
  const { usuario } = useAuth();
  if (!usuario || !roles.includes(usuario.rol)) {
    return <Navigate to="/" replace />;
  }
  return children;
}