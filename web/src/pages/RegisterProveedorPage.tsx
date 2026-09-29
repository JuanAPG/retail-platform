import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { registerProveedor } from '../api/auth';
import { Field } from '../components/ui/Field';
import { Switch } from '../components/ui/Switch';
import { IconCandado, IconFlecha, IconOjo, IconOjoCerrado, IconResultados } from '../components/ui/icons';

const LINEA_1 = 'Vende con';
const LINEA_2 = 'nosotros';

/** Efecto de máquina de escribir: "Vende con" y luego "nosotros", una sola vez al montar. */
function TituloEscritura() {
  const [texto1, setTexto1] = useState('');
  const [texto2, setTexto2] = useState('');

  useEffect(() => {
    let i = 0;
    const escribirLinea1 = setInterval(() => {
      i += 1;
      setTexto1(LINEA_1.slice(0, i));
      if (i >= LINEA_1.length) {
        clearInterval(escribirLinea1);
        let j = 0;
        const escribirLinea2 = setInterval(() => {
          j += 1;
          setTexto2(LINEA_2.slice(0, j));
          if (j >= LINEA_2.length) clearInterval(escribirLinea2);
        }, 70);
      }
    }, 70);
    return () => clearInterval(escribirLinea1);
  }, []);

  const escribiendoLinea1 = texto1.length < LINEA_1.length;
  const terminado = texto2.length === LINEA_2.length;

  return (
    <h1 className="min-h-[92px] font-display text-5xl font-normal leading-[0.95] text-arena">
      {texto1}
      {escribiendoLinea1 && <span className="inline-block w-[3px] animate-pulse">|</span>}
      <br />
      <span className="text-salvia">
        {texto2}
        {!escribiendoLinea1 && <span className={`inline-block w-[3px] ${terminado ? 'animate-pulse' : ''}`}>|</span>}
      </span>
    </h1>
  );
}

/** Mismo panel decorativo que LoginPage: DESIGN.md trata Login y Registro como pestañas de una misma pantalla. */
function PanelDecorativo() {
  return (
    <section className="relative hidden w-[480px] flex-shrink-0 flex-col overflow-hidden rounded-hero bg-teal text-arena lg:flex">
      <div className="relative z-[2] flex items-center gap-3.5 p-12 pb-8">
        <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-arena font-display text-[22px] font-extrabold text-teal">
          ra
        </span>
        <span className="text-base font-semibold">RetailAnalytics Pro</span>
      </div>

      <div className="relative h-[280px] w-full">
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-80"
          autoPlay
          loop
          muted
          playsInline
        >
          <source src="/videos/retailvideo2-alpha.webm" type="video/webm" />
          <source src="/videos/retailvideo2.mp4" type="video/mp4" />
        </video>
      </div>

      <div className="relative z-[2] flex flex-col">
        <div className="relative -translate-y-[3%] bg-[#6B0F14] px-12 py-5">
          <TituloEscritura />
        </div>
        <span className="px-12 pt-4 font-data text-[13px] text-salvia">Catálogo nacional de consumo minorista</span>
      </div>

      <div className="absolute -bottom-[140px] -right-[100px] h-[280px] w-[280px] rounded-full bg-vino opacity-55" />
      <div className="absolute -top-[40px] right-[80px] flex h-[150px] w-[150px] items-center justify-center rounded-full bg-salvia text-tinta">
        <svg viewBox="0 0 64 64" className="h-16 w-16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 50c0-22 14-34 38-36 0 22-12 36-34 36" />
          <path d="M14 50l18-18M26 36h8M30 30v6" />
        </svg>
      </div>
    </section>
  );
}

export function RegisterProveedorPage() {
  const [form, setForm] = useState({
    nombreContacto: '',
    razonSocial: '',
    rfc: '',
    telefono: '',
    email: '',
    password: '',
    confirmar: '',
  });
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.password !== form.confirmar) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (!aceptaTerminos) {
      setError('Debes aceptar los términos y condiciones.');
      return;
    }

    setSubmitting(true);
    try {
      const { mensaje } = await registerProveedor({
        nombreContacto: form.nombreContacto,
        razonSocial: form.razonSocial,
        rfc: form.rfc,
        telefono: form.telefono || undefined,
        email: form.email,
        password: form.password,
      });
      setMensajeExito(mensaje);
    } catch (err: any) {
      const m = err?.response?.data?.message ?? 'No se pudo completar el registro.';
      setError(Array.isArray(m) ? m.join(' ') : m);
    } finally {
      setSubmitting(false);
    }
  }

  if (mensajeExito) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-6 bg-marfil p-6">
        <div className="flex w-full max-w-[1000px] gap-6">
          <PanelDecorativo />
          <section className="flex flex-1 flex-col items-start justify-center gap-5 px-4 sm:px-10">
            <span className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-teal text-arena">
              <IconResultados className="h-11 w-11" />
            </span>
            <h1 className="font-display text-4xl text-teal">Solicitud enviada</h1>
            <p className="max-w-sm text-sm text-teal/80">{mensajeExito}</p>
            <Link
              to="/login"
              className="group flex h-[56px] items-center justify-between gap-3 rounded-full bg-teal py-0 pl-7 pr-2 text-[15px] font-bold text-arena transition hover:bg-vino"
            >
              Volver a Login
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-vino text-arena transition group-hover:translate-x-1 group-hover:bg-arena group-hover:text-vino">
                <IconFlecha className="h-[20px] w-[20px]" />
              </span>
            </Link>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-marfil p-6">
      <div className="flex w-full max-w-[1120px] gap-6">
        <PanelDecorativo />

        <section className="flex flex-1 flex-col justify-center gap-6 px-4 py-10 sm:px-8">
          <div className="flex gap-1 rounded-full bg-arena p-1.5">
            <Link
              to="/login"
              className="flex h-12 flex-1 items-center justify-center rounded-full text-[15px] font-bold text-teal transition hover:bg-salvia/25"
            >
              Iniciar sesión
            </Link>
            <span className="flex h-12 flex-1 items-center justify-center rounded-full bg-vino text-[15px] font-bold text-arena">
              Registrarse
            </span>
          </div>

          <div className="flex flex-col gap-4">
            <h2 className="font-display text-4xl text-vino">Vende con nosotros</h2>
            <p className="-mt-2 text-sm text-teal/70">
              Este registro es para dar de alta tu catálogo como proveedor externo. Si tu negocio quiere contratar la
              plataforma en vez de vender en ella, escríbenos a{' '}
              <a href="mailto:ventas@retail.mx" className="font-semibold text-vino underline decoration-vino/40 hover:text-teal">
                ventas@retail.mx
              </a>
              .
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field
                  id="nombreContacto"
                  label="Nombre completo"
                  required
                  value={form.nombreContacto}
                  onChange={(e) => update('nombreContacto', e.target.value)}
                  placeholder="Nombre y apellidos"
                />
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-teal">
                  Rol
                  <span className="flex h-14 items-center gap-2.5 rounded-full bg-salvia px-5 text-tinta">
                    <IconCandado className="h-[18px] w-[18px]" />
                    <span className="text-[15px] font-semibold">Proveedor Externo</span>
                  </span>
                </label>
              </div>

              <Field
                id="razonSocial"
                label="Razón social"
                required
                value={form.razonSocial}
                onChange={(e) => update('razonSocial', e.target.value)}
                placeholder="Empresa S.A. de C.V."
              />

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field
                  id="rfc"
                  label="RFC"
                  required
                  dataFont
                  value={form.rfc}
                  onChange={(e) => update('rfc', e.target.value.toUpperCase())}
                  placeholder="XAXX010101000"
                />
                <Field
                  id="telefono"
                  label="Teléfono"
                  type="tel"
                  value={form.telefono}
                  onChange={(e) => update('telefono', e.target.value)}
                  placeholder="81 0000 0000"
                />
              </div>

              <Field
                id="email"
                label="Correo"
                type="email"
                required
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="contacto@empresa.mx"
              />

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field
                  id="password"
                  label="Contraseña"
                  type={mostrarPassword ? 'text' : 'password'}
                  required
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                  placeholder="••••••••"
                  icon={<IconCandado />}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setMostrarPassword((v) => !v)}
                      aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-teal transition hover:bg-teal hover:text-arena"
                    >
                      {mostrarPassword ? <IconOjo /> : <IconOjoCerrado />}
                    </button>
                  }
                />
                <Field
                  id="confirmar"
                  label="Confirmar"
                  type="password"
                  required
                  value={form.confirmar}
                  onChange={(e) => update('confirmar', e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Switch checked={aceptaTerminos} onChange={setAceptaTerminos} tone="vino">
                  Acepto términos
                </Switch>

                {error && (
                  <p role="alert" className="rounded-full bg-vino/10 px-4 py-2 text-xs font-semibold text-vino">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className={`group flex h-[52px] items-center justify-between gap-3 rounded-full bg-teal py-0 pl-6 pr-2 text-[15px] font-bold text-arena transition hover:bg-vino disabled:cursor-not-allowed ${
                    aceptaTerminos ? 'opacity-100' : 'opacity-45'
                  }`}
                >
                  {submitting ? 'Enviando…' : 'Crear cuenta'}
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-arena text-teal transition group-hover:translate-x-0.5">
                    <IconFlecha className="h-4 w-4" />
                  </span>
                </button>
              </div>
            </form>

            <Link to="/login" className="text-center text-xs text-teal/70 underline decoration-salvia/60 hover:text-vino">
              Cancelar y volver a iniciar sesión
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
