import { useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { listaSegura } from '../../api/seguro';
import {
  aprobarObservacionPrecio,
  getObservacionesPrecio,
  ObservacionPrecio,
  rechazarObservacionPrecio,
} from '../../api/observacionesPrecio';
import { EstadoError } from '../../components/EstadoError';
import { Cargando } from '../../components/Cargando';
import { Modal } from '../../components/Modal';
import { ApprovalItem, ApprovalQueue } from '../../components/ui/ApprovalQueue';
import { ErrorText } from '../../components/ui/ErrorText';
import { StatusPill } from '../../components/ui/StatusPill';
import { TextArea } from '../../components/ui/TextArea';
import { IconPrecios } from '../../components/ui/icons';

const moneda = (v: string | number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(v));

function fecha(iso: string): string {
  const f = new Date(iso);
  return Number.isNaN(f.getTime()) ? '—' : new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(f);
}

/**
 * Precios levantados en tienda con la app móvil (pricing-service, D-16). Quedan
 * pendientes y NO mueven el precio vigente hasta que el Responsable de precios
 * los aprueba; al rechazar el motivo es obligatorio.
 */
export function ObservacionesPrecioPanel() {
  const pendientes = useFetch(() => getObservacionesPrecio({ status: 'pendiente', limit: 50 }), []);
  const [aRechazar, setARechazar] = useState<ObservacionPrecio | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enProceso, setEnProceso] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function aprobar(o: ObservacionPrecio) {
    setError(null);
    setAviso(null);
    setEnProceso(o.id);
    try {
      await aprobarObservacionPrecio(o.id);
      setAviso(`Precio de ${moneda(o.price)} aprobado: ya es el precio vigente en ${o.store?.nombre ?? 'la tienda'}.`);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo aprobar la observación.'));
    } finally {
      setEnProceso(null);
      // Si otro la resolvió antes (409) o ya no existe (404), la cola se refresca igual.
      pendientes.refetch();
    }
  }

  async function confirmarRechazo() {
    if (!aRechazar) return;
    if (motivo.trim().length < 10) {
      setErrorModal('Explica el motivo del rechazo (mínimo 10 caracteres).');
      return;
    }
    setEnProceso(aRechazar.id);
    setErrorModal(null);
    try {
      await rechazarObservacionPrecio(aRechazar.id, motivo.trim());
      setAviso('Observación rechazada.');
      setARechazar(null);
      setMotivo('');
    } catch (err) {
      setErrorModal(mensajeDeError(err, 'No se pudo rechazar la observación.'));
    } finally {
      setEnProceso(null);
      pendientes.refetch();
    }
  }

  const items: ApprovalItem[] = listaSegura<ObservacionPrecio>(pendientes.data?.data).map((o) => ({
    id: o.id,
    avatar: <IconPrecios className="h-[18px] w-[18px]" />,
    title: `${o.presentation?.producto?.nombre ?? 'Producto'} — ${o.presentation?.nombre ?? ''}`.trim(),
    subtitle: `${moneda(o.price)} en ${o.store?.nombre ?? 'tienda'}`,
    approveLabel: enProceso === o.id ? 'Aprobando…' : 'Aprobar precio',
    onApprove: () => {
      if (enProceso === null) void aprobar(o);
    },
    onReject: () => {
      setErrorModal(null);
      setMotivo('');
      setARechazar(o);
    },
    detail: (
      <div className="flex flex-wrap gap-2 text-xs">
        <StatusPill tone="neutral">{`Levantado ${fecha(o.observedAt)}`}</StatusPill>
        {o.lat !== null && o.lng !== null && o.lat !== undefined && o.lng !== undefined && (
          <StatusPill tone="neutral">{`GPS ${Number(o.lat).toFixed(4)}, ${Number(o.lng).toFixed(4)}`}</StatusPill>
        )}
      </div>
    ),
  }));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-2xl text-vino">Precios observados en tienda</h2>
      <p className="text-sm text-teal/70">Levantados con la app móvil. No cambian el precio vigente hasta que los apruebes.</p>
      {aviso && <p className="rounded-full bg-salvia/30 px-4 py-2.5 text-sm font-semibold text-teal">{aviso}</p>}
      {error && <ErrorText>{error}</ErrorText>}
      {pendientes.loading && !pendientes.data && <Cargando etiqueta="Cargando observaciones…" />}
      {pendientes.error && <EstadoError mensaje={pendientes.error} onReintentar={pendientes.reintentable ? pendientes.refetch : undefined} />}
      {pendientes.data && <ApprovalQueue items={items} emptyLabel="Sin precios observados por revisar" />}

      {aRechazar && (
        <Modal titulo="Rechazar precio observado" onCerrar={() => setARechazar(null)}>
          <div className="flex flex-col gap-3">
            <TextArea id="motivo-rechazo-obs" label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            {errorModal && <ErrorText>{errorModal}</ErrorText>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setARechazar(null)} className="rounded-full px-5 py-2.5 text-sm font-bold text-teal hover:bg-arena">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarRechazo}
                disabled={enProceso !== null}
                className="rounded-full bg-vino px-5 py-2.5 text-sm font-bold text-arena disabled:opacity-50"
              >
                {enProceso !== null ? 'Rechazando…' : 'Rechazar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
