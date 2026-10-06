import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function EstadoSesion() {
  const { expiraEn } = useAuth();
  const [, forzar] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forzar((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (expiraEn === null) return null;
  const minutos = Math.max(Math.round((expiraEn - Date.now()) / 60_000), 0);
  return (
    <span className="sesion-info" title="El token se renueva solo un minuto antes de vencer">
      Token válido hasta {new Date(expiraEn).toLocaleTimeString('es-MX')} (≈ {minutos} min)
    </span>
  );
}