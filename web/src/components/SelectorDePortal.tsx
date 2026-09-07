import { useLocation, useNavigate } from 'react-router-dom';
import { PORTALES } from '../routes/portalPorRol';

/**
 * Permite al Administrador moverse entre los portales de los demás
 * roles sin cerrar sesión. Se muestra ÚNICAMENTE a ese rol: los demás
 * usuarios no tienen a dónde cambiar, y el ProtectedRoute los rebota
 * igual si escriben la ruta a mano.
 *
 * Es una ayuda de navegación, no un permiso: lo que el Administrador
 * puede hacer en cada pantalla lo sigue decidiendo el backend.
 */
export function SelectorDePortal() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const actual = PORTALES.find((p) => p.ruta === pathname)?.ruta ?? '';

  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      <span className="hidden sm:inline">Ver como</span>
      <select
        aria-label="Cambiar de portal"
        value={actual}
        onChange={(e) => navigate(e.target.value)}
        className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
      >
        {actual === '' && <option value="">Selecciona un portal</option>}
        {PORTALES.map((p) => (
          <option key={p.ruta} value={p.ruta}>
            {p.etiqueta}
          </option>
        ))}
      </select>
    </label>
  );
}
