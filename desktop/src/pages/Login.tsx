import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ChartColumn, Eye, EyeOff, LoaderCircle, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { extractErrorMessage } from '../api/httpClient';
import { ROLES_ESCRITORIO } from '../config/menu';
import Aviso from '../components/Aviso';

/** "Acceso no permitido: tu perfil…" → "Tu perfil…" (el título del aviso ya lo dice). */
function sinPrefijo(mensaje: string): string {
  const resto = mensaje.replace(/^Acceso no permitido:\s*/, '');
  return resto.charAt(0).toUpperCase() + resto.slice(1);
}

export default function Login() {
  const { login, aviso, isLoggedIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Con sesión válida no tiene caso ver el login.
  if (isLoggedIn) return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError('Correo y contraseña son obligatorios');
      return;
    }

    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      // Un perfil fuera de D-31 llega aquí con "Acceso no permitido" y se queda en el login.
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const mensaje = error ?? aviso;
  // D-31: un perfil que no usa el escritorio. Se explica con calma, no como un error del sistema.
  const accesoNoPermitido = mensaje?.startsWith('Acceso no permitido') ?? false;

  return (
    <main className="login-pantalla">
      <form className="login-tarjeta" onSubmit={handleSubmit} noValidate>
        <header className="login-encabezado">
          <span className="login-logo" aria-hidden="true">
            <ChartColumn size={28} />
          </span>
          <h1>Retail Decision</h1>
          <p>Escritorio de análisis comercial</p>
          <div className="login-roles" aria-label="Perfiles que usan esta aplicación">
            {ROLES_ESCRITORIO.map((rol) => (
              <span key={rol} className="pill">
                {rol}
              </span>
            ))}
          </div>
        </header>

        <label htmlFor="login-correo">
          Correo
          <input
            id="login-correo"
            type="email"
            autoComplete="username"
            autoFocus
            placeholder="nombre@empresa.mx"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label htmlFor="login-password">
          Contraseña
          <span className="campo-password">
            <input
              id="login-password"
              type={verPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setVerPassword((v) => !v)}
              aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={verPassword}
              title={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {verPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </span>
        </label>

        {mensaje &&
          (accesoNoPermitido ? (
            <Aviso tipo="advertencia" titulo="Esta aplicación no está disponible para tu perfil">
              {sinPrefijo(mensaje)} Puedes seguir trabajando desde el sistema web.
            </Aviso>
          ) : (
            <Aviso tipo="error">{mensaje}</Aviso>
          ))}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <LoaderCircle size={18} className="girar" aria-hidden="true" />
              Entrando…
            </>
          ) : (
            <>
              <LogIn size={18} aria-hidden="true" />
              Iniciar sesión
            </>
          )}
        </button>
        <p className="login-pie">Servicio: auth-service</p>
      </form>
    </main>
  );
}
