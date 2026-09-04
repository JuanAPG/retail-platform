import { useEffect, useState } from 'react';

interface UseFetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): UseFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          const mensaje =
            err?.response?.data?.message ?? 'No se pudo cargar la información. Intenta de nuevo.';
          setError(Array.isArray(mensaje) ? mensaje.join(' ') : mensaje);
        }
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
