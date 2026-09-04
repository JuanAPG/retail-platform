import { AxiosError } from 'axios';

/**
 * Traduce cualquier error de axios al mensaje que se le muestra al usuario.
 *
 * Se distingue explícitamente el caso "la petición nunca llegó al backend"
 * (API apagada, VITE_API_URL mal configurada, CORS) del caso "el backend
 * respondió con un error": antes ambos caían en el mismo mensaje genérico
 * y era imposible saber si el problema era la contraseña o la conexión.
 */
export function mensajeDeError(
  err: unknown,
  fallback = 'Ocurrió un error inesperado. Intenta de nuevo.',
): string {
  const error = err as AxiosError<{ message?: string | string[] }>;

  if (error?.isAxiosError && !error.response) {
    return 'No se pudo conectar con el servidor. Verifica que el backend esté corriendo y que VITE_API_URL apunte a la dirección correcta.';
  }

  const message = error?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string') return message;

  return fallback;
}
