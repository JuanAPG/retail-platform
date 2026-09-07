import { useCallback, useEffect, useState } from 'react';
import { mensajeDeError } from '../api/errores';

export interface UseFetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Vuelve a ejecutar la petición (botón "Reintentar" / "Actualizar"). */
  refetch: () => void;
}

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): UseFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  const refetch = useCallback(() => setIntento((n) => n + 1), []);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!cancelado) setData(result);
      })
      .catch((err) => {
        if (!cancelado) {
          setError(mensajeDeError(err, 'No se pudo cargar la información. Intenta de nuevo.'));
        }
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intento]);

  return { data, loading, error, refetch };
}
