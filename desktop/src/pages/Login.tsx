import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { extractErrorMessage } from '../api/httpClient';

export default function Login() {
  const { login, aviso, isLoggedIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <form onSubmit={handleSubmit} style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1>Retail Decision — Escritorio</h1>
        <p className="muted">Para Analista comercial, Responsable de precios y Planeador.</p>

        <label>
          Correo
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {mensaje && (
          <p className="alert-error" role="alert">
            {mensaje}
          </p>
        )}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Ingresando...' : 'Iniciar sesión'}
        </button>
        <p className="muted">Servicio: auth-service</p>
      </form>
    </div>
  );
}
