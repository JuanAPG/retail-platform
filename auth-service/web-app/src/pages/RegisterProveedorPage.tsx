import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerProveedor } from '../api/auth';

export function RegisterProveedorPage() {
  const navigate = useNavigate();
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
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-md rounded border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Solicitud enviada</h1>
          <p className="mt-2 text-sm text-slate-600">{mensajeExito}</p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Volver a Login
          </Link>
        </div>
      </div>
    );
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
        <div className="w-full max-w-xl rounded border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">Registro de proveedor</h1>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
              SOLO PROVEEDOR EXTERNO
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Crea tu cuenta para proponer productos al catálogo nacional
          </p>

          <form onSubmit={handleSubmit} className="mt-6 grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase text-slate-500">
                Nombre completo
              </label>
              <input
                required
                value={form.nombreContacto}
                onChange={(e) => update('nombreContacto', e.target.value)}
                placeholder="Nombre del representante"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase text-slate-500">
                Razón social
              </label>
              <input
                required
                value={form.razonSocial}
                onChange={(e) => update('razonSocial', e.target.value)}
                placeholder="Empresa S.A. de C.V."
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-slate-500">RFC</label>
              <input
                required
                value={form.rfc}
                onChange={(e) => update('rfc', e.target.value.toUpperCase())}
                placeholder="XAXX010101000"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-slate-500">
                Teléfono de contacto
              </label>
              <input
                value={form.telefono}
                onChange={(e) => update('telefono', e.target.value)}
                placeholder="55 1234 5678"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase text-slate-500">
                Correo electrónico
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="contacto@proveedor.com"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-slate-500">
                Contraseña
              </label>
              <input
                type="password"
                required
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-slate-500">
                Confirmar contraseña
              </label>
              <input
                type="password"
                required
                value={form.confirmar}
                onChange={(e) => update('confirmar', e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <label className="col-span-2 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={aceptaTerminos}
                onChange={(e) => setAceptaTerminos(e.target.checked)}
              />
              Acepto los términos y condiciones de uso de la plataforma
            </label>

            {error && (
              <p role="alert" className="col-span-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}

            <div className="col-span-2 flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {submitting ? 'Enviando…' : 'Crear cuenta'}
              </button>
              <Link
                to="/login"
                className="rounded border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </Link>
            </div>

            <p className="col-span-2 text-center text-xs text-slate-400">
              Tu cuenta será revisada por el Administrador antes de ser activada.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
