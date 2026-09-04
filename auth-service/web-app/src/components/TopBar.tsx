import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface TopBarProps {
  breadcrumb: string;
}

export function TopBar({ breadcrumb }: TopBarProps) {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const iniciales = usuario?.nombre
    ? usuario.nombre
        .split(' ')
        .slice(0, 2)
        .map((p) => p[0])
        .join('')
        .toUpperCase()
    : '?';

  return (
    <header className="flex items-center justify-between bg-slate-900 px-6 py-3 text-slate-100">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-700 text-xs font-semibold">
          RA
        </div>
        <span className="text-base font-semibold">RetailAnalytics Pro</span>
        <span className="text-slate-500">›</span>
        <span className="text-sm text-slate-300">{breadcrumb}</span>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label="Notificaciones"
          className="rounded-full p-1.5 text-slate-300 hover:bg-slate-800"
        >
          🔔
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold">
            {iniciales}
          </div>
          <div className="leading-tight">
            <p className="text-sm font-medium">{usuario?.nombre}</p>
            <p className="text-xs text-slate-400">{usuario?.rol}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}
