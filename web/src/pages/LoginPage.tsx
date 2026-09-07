import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { portalDelRol } from '../routes/portalPorRol';
import { mensajeDeError } from '../api/errores';

export function LoginPage() {
  const { login, usuario, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Si ya hay sesión válida (p. ej. se entró a /login escribiendo la URL),
  // no tiene sentido pedir credenciales otra vez.
  useEffect(() => {
    if (isAuthenticated && usuario) {
      navigate(portalDelRol(usuario.rol), { replace: true });
    }
  }, [isAuthenticated, usuario, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const usuarioAutenticado = await login(email, password);
      navigate(portalDelRol(usuarioAutenticado.rol), { replace: true });
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo iniciar sesión.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="flex items-center gap-3 bg-slate-900 px-6 py-4 text-slate-100">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-700 text-xs font-semibold">
          RA
        </div>
        <span className="text-base font-semibold">RetailAnalytics Pro</span>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-slate-500">
            Acceso para usuarios internos y proveedores
          </p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium uppercase text-slate-500">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@empresa.com"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-xs font-medium uppercase text-slate-500"
              >
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>

            {error && (
              <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-400">
            <p>Los roles internos son creados por el Administrador.</p>
            <p>
              Solo los proveedores externos se{' '}
              <Link to="/registro-proveedor" className="font-medium text-slate-600 underline">
                auto-registran
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
