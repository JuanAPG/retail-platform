import { Link } from 'react-router-dom';

export function NotAuthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 px-4 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">No tienes acceso a esta pantalla</h1>
      <p className="max-w-sm text-sm text-slate-500">
        Tu rol no tiene permiso para ver este módulo. Si crees que es un error, contacta al
        Administrador.
      </p>
      <Link to="/login" className="mt-2 text-sm font-medium text-slate-700 underline">
        Volver a Login
      </Link>
    </div>
  );
}
