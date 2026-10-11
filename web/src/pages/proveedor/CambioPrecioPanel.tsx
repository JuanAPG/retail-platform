import { FormEvent, useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { getPropuestasPrecio, proponerPrecio, PropuestaPrecio } from '../../api/propuestasPrecio';
import { Producto } from '../../types';
import { EstadoError } from '../../components/EstadoError';
import { Card } from '../../components/ui/Card';
import { CtaButton } from '../../components/ui/CtaButton';
import { ErrorText } from '../../components/ui/ErrorText';
import { StatusPill } from '../../components/ui/StatusPill';

const moneda = (v: string | number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(v));

const inputClass =
  'h-14 rounded-full border-2 border-transparent bg-arena px-5 text-[15px] text-tinta outline-none transition focus:border-vino focus:bg-marfil hover:border-salvia/60 disabled:opacity-50';
const labelClass = 'flex flex-col gap-1.5 text-[13px] font-semibold text-teal';

const ESTATUS: Record<PropuestaPrecio['status'], { tono: 'ok' | 'warn' | 'neutral'; texto: string }> = {
  pendiente: { tono: 'neutral', texto: 'En revisión' },
  aprobado: { tono: 'ok', texto: 'Aprobada' },
  rechazado: { tono: 'warn', texto: 'Rechazada' },
};

/**
 * Cambio de precio del Proveedor (pricing-service, RN-14). La propuesta nace
 * pendiente y ligada a SU empresa; quien aprueba es el Responsable de precios.
 * Solo se puede proponer sobre presentaciones de productos ya aprobados.
 */
export function CambioPrecioPanel({ productos, puedeProponer }: { productos: Producto[]; puedeProponer: boolean }) {
  const propuestas = useFetch(() => getPropuestasPrecio({ limit: 50 }), []);

  const [presentacionId, setPresentacionId] = useState('');
  const [precio, setPrecio] = useState('');
  const [unidadCompra, setUnidadCompra] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const opciones = productos
    .filter((p) => p.estatus === 'activo')
    .flatMap((p) => p.presentaciones.filter((pr) => pr.activo).map((pr) => ({ id: pr.id, texto: `${p.nombre} — ${pr.nombre}` })));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    const valor = Number(precio);
    if (!presentacionId) return setError('Elige la presentación a la que cambia el precio.');
    if (!Number.isFinite(valor) || valor <= 0) return setError('El precio propuesto debe ser mayor que cero.');
    setEnviando(true);
    try {
      await proponerPrecio({ presentationId: presentacionId, proposedPrice: valor, ...(unidadCompra.trim() ? { purchaseUnit: unidadCompra.trim() } : {}) });
      setAviso('Propuesta enviada. El Responsable de precios la revisará.');
      setPresentacionId('');
      setPrecio('');
      setUnidadCompra('');
      propuestas.refetch();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo enviar la propuesta.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl text-vino">Cambio de precio</h1>

      {puedeProponer ? (
        <form onSubmit={enviar} className="flex flex-wrap items-end gap-4">
          <label className={labelClass}>
            Presentación
            <select className={inputClass} value={presentacionId} onChange={(e) => setPresentacionId(e.target.value)}>
              <option value="">Elige una…</option>
              {opciones.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.texto}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Precio propuesto (MXN)
            <input type="number" min="0" step="0.01" className={inputClass} value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </label>
          <label className={labelClass}>
            Unidad de compra (opcional)
            <input type="text" maxLength={30} className={inputClass} value={unidadCompra} onChange={(e) => setUnidadCompra(e.target.value)} />
          </label>
          <CtaButton type="submit" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Proponer precio'}
          </CtaButton>
        </form>
      ) : (
        <p className="text-sm text-teal/70">Solo un Proveedor puede proponer cambios de precio. Aquí ves las propuestas existentes.</p>
      )}
      {opciones.length === 0 && puedeProponer && (
        <p className="text-sm text-teal/70">Aún no tienes productos aprobados con presentaciones activas.</p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {aviso && <p className="rounded-full bg-salvia/30 px-4 py-2.5 text-sm font-semibold text-teal">{aviso}</p>}

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-2xl text-vino">Mis propuestas</h2>
        {propuestas.loading && <p className="text-sm text-teal/70">Cargando…</p>}
        {propuestas.error && <EstadoError mensaje={propuestas.error} onReintentar={propuestas.reintentable ? propuestas.refetch : undefined} />}
        {propuestas.data?.data.length === 0 && <p className="text-sm text-teal/70">Todavía no has enviado propuestas de precio.</p>}
        {propuestas.data?.data.map((p) => (
          <Card key={p.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-tinta">
                {p.presentation?.producto?.nombre ?? 'Producto'} — {p.presentation?.nombre}
              </span>
              <StatusPill tone={ESTATUS[p.status].tono}>{ESTATUS[p.status].texto}</StatusPill>
            </div>
            <span className="font-data text-sm text-teal">{moneda(p.proposedPrice)}</span>
            {p.status === 'rechazado' && p.rejectionReason && <span className="text-xs text-vino">Motivo: {p.rejectionReason}</span>}
          </Card>
        ))}
      </div>
    </div>
  );
}
