import { FormEvent, useEffect, useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { getAlertaPrecio, guardarAlertaPrecio } from '../../api/alertasPrecio';
import { EstadoError } from '../../components/EstadoError';
import { Cargando } from '../../components/Cargando';
import { CtaButton } from '../../components/ui/CtaButton';
import { ErrorText } from '../../components/ui/ErrorText';

const inputClass =
  'h-14 w-40 rounded-full border-2 border-transparent bg-marfil px-5 text-[15px] text-tinta outline-none transition focus:border-vino hover:border-salvia/60 disabled:opacity-50';
const labelClass = 'flex flex-col gap-1.5 text-[13px] font-semibold text-teal';

/**
 * Alerta de cambio de precio (PRI-07): variación acumulada (%) en una ventana
 * de días que dispara el aviso. La configura solo el Responsable de precios;
 * los demás perfiles la ven.
 */
export function AlertaPrecioCard({ puedeEditar }: { puedeEditar: boolean }) {
  const config = useFetch(getAlertaPrecio, []);
  const [umbral, setUmbral] = useState('');
  const [ventana, setVentana] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (config.data && typeof config.data === 'object') {
      setUmbral(String(config.data.umbralPct ?? ''));
      setVentana(String(config.data.ventanaDias ?? ''));
    }
  }, [config.data]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    const u = Number(umbral);
    const v = Number(ventana);
    if (!Number.isFinite(u) || u <= 0 || u > 100) return setError('El umbral debe ser mayor que 0 y hasta 100 (%).');
    if (!Number.isInteger(v) || v < 1 || v > 365) return setError('La ventana debe ser un número entero de 1 a 365 días.');
    setGuardando(true);
    try {
      await guardarAlertaPrecio({ umbralPct: u, ventanaDias: v });
      setAviso('Alerta guardada.');
      config.refetch();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar la alerta.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-panel bg-arena p-6">
      <h2 className="font-slab text-[22px] text-vino">Alerta de cambio de precio</h2>
      <p className="text-sm text-teal/70">Avisa cuando el precio de una presentación cambia más de este porcentaje acumulado dentro de la ventana.</p>
      {config.loading && !config.data && <Cargando etiqueta="Cargando configuración…" />}
      {config.error && <EstadoError mensaje={config.error} onReintentar={config.reintentable ? config.refetch : undefined} />}
      {config.data && (
        <form noValidate onSubmit={guardar} className="flex flex-wrap items-end gap-4">
          <label className={labelClass}>
            Umbral (%)
            <input type="number" step="0.01" className={inputClass} value={umbral} disabled={!puedeEditar} onChange={(e) => setUmbral(e.target.value)} />
          </label>
          <label className={labelClass}>
            Ventana (días)
            <input type="number" step="1" className={inputClass} value={ventana} disabled={!puedeEditar} onChange={(e) => setVentana(e.target.value)} />
          </label>
          {puedeEditar ? (
            <CtaButton type="submit" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar alerta'}
            </CtaButton>
          ) : (
            <p className="text-xs text-teal/70">Solo el Responsable de precios modifica esta configuración.</p>
          )}
        </form>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {aviso && <p className="rounded-full bg-salvia/30 px-4 py-2.5 text-sm font-semibold text-teal">{aviso}</p>}
    </section>
  );
}
