import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { portalDelRol } from '../routes/portalPorRol';
import { mensajeDeError } from '../api/errores';
import { Field } from '../components/ui/Field';
import { Switch } from '../components/ui/Switch';
import { IconCandado, IconCorreo, IconFlecha, IconOjo, IconOjoCerrado } from '../components/ui/icons';

/** DESIGN.md — pantalla de Acceso. Referencia pixel a pixel: docs/design/prototipos/Main.dc.html. */
export function LoginPage() {
  const { login, usuario, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [recordarme, setRecordarme] = useState(true);
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
    <div className="flex h-screen items-center justify-center overflow-hidden bg-marfil p-6">
      <div className="flex h-full w-full max-w-[1280px] max-h-[820px] gap-6">
        {/* Panel decorativo — oculto en pantallas chicas, la sesión importa más que el arte. */}
        <section className="relative hidden w-[560px] flex-shrink-0 flex-col justify-between overflow-hidden rounded-hero bg-teal p-14 text-arena lg:flex">
          <div className="relative z-[2] flex items-center gap-3.5">
            <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-arena font-display text-[22px] font-extrabold text-teal">
              ra
            </span>
            <span className="text-base font-semibold">RetailAnalytics Pro</span>
          </div>

          <div className="relative z-[2] flex flex-col gap-6">
            <h1 className="font-display text-6xl font-normal leading-[0.95]">
              Del anaquel
              <br />
              <span className="text-salvia">
                a la decisión
                <span className="text-vino [-webkit-text-stroke:2px_#F0ECDF]">.</span>
              </span>
            </h1>
            <span className="font-data text-[13px] text-salvia">Consumo minorista</span>
          </div>

          {/* Orbes decorativos, tal cual Main.dc.html (escalados al panel de 560px). */}
          <div className="absolute -right-[37px] -top-[44px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta transition duration-500 hover:-translate-y-3.5 hover:scale-105">
            <svg viewBox="0 0 64 64" className="h-[74px] w-[74px] mt-8" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 24h48l-5 26a5 5 0 0 1-5 4H18a5 5 0 0 1-5-4z" />
              <path d="M20 24l12-14 12 14" />
            </svg>
          </div>
          <div className="absolute right-[140px] top-[52px] flex h-24 w-24 items-center justify-center rounded-full bg-arena text-teal transition duration-500 hover:-translate-y-3.5 hover:scale-105">
            <svg viewBox="0 0 64 64" className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 22l6-12h12l6 12v30a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4z" />
              <path d="M20 22h24" />
            </svg>
          </div>
          <div className="absolute right-11 top-[162px] flex h-20 w-20 items-center justify-center rounded-full bg-vino text-arena transition duration-500 hover:-translate-y-3.5 hover:scale-105">
            <svg viewBox="0 0 64 64" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 32V12a3 3 0 0 1 3-3h20l25 25-23 23z" />
              <circle cx="20" cy="21" r="4" />
            </svg>
          </div>
          <div className="absolute right-[184px] top-[170px] flex h-[66px] w-[66px] items-center justify-center rounded-full text-arena shadow-[inset_0_0_0_3px_#F0ECDF] transition duration-500 hover:-translate-y-3.5 hover:scale-105">
            <svg viewBox="0 0 64 64" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="20" y="8" width="24" height="48" rx="9" />
              <path d="M20 18h24M20 46h24" />
            </svg>
          </div>
          <div className="absolute -bottom-[147px] -right-[118px] h-[310px] w-[310px] rounded-full bg-vino opacity-55" />
        </section>

        {/* Panel de acceso */}
        <section className="flex flex-1 flex-col justify-center gap-7 px-4 py-10 sm:px-10">
          <div className="flex gap-1 rounded-full bg-arena p-1.5">
            <span className="flex h-12 flex-1 items-center justify-center rounded-full bg-vino text-[15px] font-bold text-arena">
              Iniciar sesión
            </span>
            <Link
              to="/registro-proveedor"
              className="flex h-12 flex-1 items-center justify-center rounded-full text-[15px] font-bold text-teal transition hover:bg-salvia/25"
            >
              Soy proveedor
            </Link>
          </div>

          <div className="flex flex-col gap-[18px]">
            <h2 className="font-display text-5xl font-normal text-vino">Hola de nuevo</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
              <Field
                id="email"
                label="Correo"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@retail.mx"
                icon={<IconCorreo />}
              />

              <Field
                id="password"
                label="Contraseña"
                type={mostrarPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                icon={<IconCandado />}
                trailing={
                  <button
                    type="button"
                    onClick={() => setMostrarPassword((v) => !v)}
                    aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-teal transition hover:bg-teal hover:text-arena"
                  >
                    {mostrarPassword ? <IconOjoCerrado /> : <IconOjo />}
                  </button>
                }
              />

              <div className="flex items-center justify-between">
                <Switch checked={recordarme} onChange={setRecordarme}>
                  Recordarme
                </Switch>
                <a href="#" className="rounded-full px-3.5 py-2 text-sm font-semibold text-teal transition hover:bg-vino hover:text-arena">
                  ¿Olvidaste tu contraseña?
                </a>
              </div>

              {error && (
                <p role="alert" className="rounded-full bg-vino/10 px-5 py-3 text-sm font-semibold text-vino">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="group flex h-[60px] items-center justify-between rounded-full bg-teal py-0 pl-7 pr-2 text-[17px] font-bold text-arena transition hover:bg-tinta disabled:opacity-60"
              >
                {submitting ? 'Ingresando…' : 'Ingresar'}
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-vino text-arena transition group-hover:translate-x-1 group-hover:-rotate-45 group-hover:bg-arena group-hover:text-vino">
                  <IconFlecha className="h-[22px] w-[22px]" />
                </span>
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
