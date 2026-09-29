import { Link } from 'react-router-dom';
import { IconCandado } from '../components/ui/icons';

export function NotAuthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-marfil px-4 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-vino/10 text-vino">
        <IconCandado className="h-7 w-7" />
      </span>
      <h1 className="font-display text-3xl text-vino">No tienes acceso a esta pantalla</h1>
      <p className="max-w-sm text-sm text-teal/80">
        Tu rol no tiene permiso para ver este módulo. Si crees que es un error, contacta al
        Administrador.
      </p>
      <Link
        to="/login"
        className="mt-2 rounded-full px-4 py-2 text-sm font-bold text-teal underline decoration-salvia/60 transition hover:bg-teal hover:text-arena hover:no-underline"
      >
        Volver a Login
      </Link>
    </div>
  );
}
