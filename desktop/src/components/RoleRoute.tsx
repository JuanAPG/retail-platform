import { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { puedeVerRuta } from '../config/menu';

/**
 * Protege una ruta por rol. Ocultar el botón del menú no basta: alguien podría llegar a la ruta
 * directo, así que cada pantalla pasa por aquí (con la misma regla que el menú, `config/menu.ts`).
 * El servidor revisa el permiso otra vez y responde 403.
 */
export default function RoleRoute({ path, children }: { path: string; children: ReactElement }) {
  const { usuario } = useAuth();
  if (!puedeVerRuta(usuario?.rol, path)) return <Navigate to="/" replace />;
  return children;
}
