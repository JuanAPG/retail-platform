import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authApi, limpiarSesion } from '../api/client';
import { mensajeDeError } from '../api/errores';

export function PasswordRecoveryPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = token
        ? await authApi.post<{ message: string }>('/auth/password-reset/confirm', { token, password: value })
        : await authApi.post<{ message: string }>('/auth/password-reset/request', { email: value.trim() });
      if (token) limpiarSesion();
      setValue('');
      setMessage(response.data.message);
    } catch (cause) {
      setError(mensajeDeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto my-16 max-w-lg rounded-panel bg-arena p-8 text-teal">
      <h1 className="mb-5 font-display text-3xl">{token ? 'Cambia tu contraseña' : 'Recupera tu contraseña'}</h1>
      {message ? <p role="status">{message}</p> : (
        <form className="grid gap-4" onSubmit={submit}>
          <label>
            {token ? 'Nueva contraseña' : 'Correo electrónico'}
            <input className="mt-2 block w-full rounded border border-teal/30 p-2"
              type={token ? 'password' : 'email'} autoComplete={token ? 'new-password' : 'email'}
              minLength={token ? 8 : undefined} maxLength={token ? 72 : 150} required value={value}
              onChange={(event) => setValue(event.target.value)} />
          </label>
          {token && <p className="text-sm">Usa al menos ocho caracteres, una mayúscula, una minúscula y un número.</p>}
          {error && <p role="alert" className="text-vino">{error}</p>}
          <button className="rounded-full bg-teal px-5 py-3 text-arena" type="submit" disabled={busy}>
            {busy ? 'Enviando…' : token ? 'Guardar contraseña' : 'Enviar enlace'}
          </button>
        </form>
      )}
      <Link to="/login" reloadDocument className="mt-6 inline-block underline">Volver al inicio de sesión</Link>
    </main>
  );
}
