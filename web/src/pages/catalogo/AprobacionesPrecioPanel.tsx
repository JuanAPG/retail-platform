import { useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { getTiendas } from '../../api/catalogo';
import { aprobarPropuestaPrecio, getPropuestasPrecio, PropuestaPrecio, rechazarPropuestaPrecio } from '../../api/propuestasPrecio';
import { EstadoError } from '../../components/EstadoError';
import { Modal } from '../../components/Modal';
import { ApprovalItem, ApprovalQueue } from '../../components/ui/ApprovalQueue';
import { ErrorText } from '../../components/ui/ErrorText';
import { StatusPill } from '../../components/ui/StatusPill';
import { TextArea } from '../../components/ui/TextArea';
import { IconPrecios } from '../../components/ui/icons';
import { ObservacionesPrecioPanel } from './ObservacionesPrecioPanel';
import { listaSegura } from '../../api/seguro';

const moneda = (v: string | number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(v));

/**
 * Bandeja del Responsable de precios (pricing-service, RN-14). Es el único
 * perfil que resuelve: al aprobar elige en qué tiendas aplica el precio; al
 * rechazar el motivo es obligatorio para que el proveedor sepa qué corregir.
 */
export function AprobacionesPrecioPanel() {
  const pendientes = useFetch(() => getPropuestasPrecio({ status: 'pendiente', limit: 50 }), []);
  const tiendas = useFetch(getTiendas, []);

  const [aAprobar, setAAprobar] = useState<PropuestaPrecio | null>(null);
  const [aRechazar, setARechazar] = useState<PropuestaPrecio | null>(null);
  const [tiendasElegidas, setTiendasElegidas] = useState<string[]>([]);
  const [motivo, setMotivo] = useState('');
  const [enProceso, setEnProceso] = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function cerrar() {
    setAAprobar(null);
    setARechazar(null);
    setTiendasElegidas([]);
    setMotivo('');
    setErrorModal(null);
  }

  async function confirmarAprobacion() {
    if (!aAprobar) return;
    if (tiendasElegidas.length === 0) {
      setErrorModal('Elige al menos una tienda donde se aplicará el precio.');
      return;
    }
    setEnProceso(true);
    setErrorModal(null);
    try {
      await aprobarPropuestaPrecio(aAprobar.id, { storeIds: tiendasElegidas });
      setAviso(`Precio aprobado y aplicado en ${tiendasElegidas.length} tienda(s).`);
      cerrar();
      pendientes.refetch();
    } catch (err) {
      setErrorModal(mensajeDeError(err, 'No se pudo aprobar la propuesta.'));
      // 409: alguien más ya la resolvió; se refresca para que salga de la bandeja.
      pendientes.refetch();
    } finally {
      setEnProceso(false);
    }
  }

  async function confirmarRechazo() {
    if (!aRechazar) return;
    if (motivo.trim().length < 10) {
      setErrorModal('Explica el motivo del rechazo (mínimo 10 caracteres).');
      return;
    }
    setEnProceso(true);
    setErrorModal(null);
    try {
      await rechazarPropuestaPrecio(aRechazar.id, motivo.trim());
      setAviso('Propuesta rechazada; el proveedor verá el motivo.');
      cerrar();
      pendientes.refetch();
    } catch (err) {
      setErrorModal(mensajeDeError(err, 'No se pudo rechazar la propuesta.'));
      pendientes.refetch();
    } finally {
      setEnProceso(false);
    }
  }

  const items: ApprovalItem[] = listaSegura<PropuestaPrecio>(pendientes.data?.data).map((p) => ({
    id: p.id,
    avatar: <IconPrecios className="h-[18px] w-[18px]" />,
    title: `${p.presentation?.producto?.nombre ?? 'Producto'} — ${p.presentation?.nombre ?? ''}`.trim(),
    subtitle: `Propone ${moneda(p.proposedPrice)}`,
    approveLabel: 'Aprobar y elegir tiendas',
    onApprove: () => setAAprobar(p),
    onReject: () => setARechazar(p),
    detail: (
      <div className="flex flex-wrap gap-2 text-xs">
        {p.presentation?.producto?.sku && <StatusPill tone="neutral">{`SKU ${p.presentation.producto.sku}`}</StatusPill>}
        {p.purchaseUnit && <StatusPill tone="neutral">{p.purchaseUnit}</StatusPill>}
        <StatusPill tone="neutral">{`Enviada ${new Date(p.createdAt).toLocaleDateString('es-MX')}`}</StatusPill>
      </div>
    ),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-4xl text-vino">Aprobaciones de precio</h1>
        <StatusPill tone="neutral">Aprueba</StatusPill>
      </div>
      {aviso && <p className="rounded-full bg-salvia/30 px-4 py-2.5 text-sm font-semibold text-teal">{aviso}</p>}
      {pendientes.loading && <p className="text-sm text-teal/70">Cargando propuestas…</p>}
      {pendientes.error && <EstadoError mensaje={pendientes.error} onReintentar={pendientes.reintentable ? pendientes.refetch : undefined} />}
      {pendientes.data && <ApprovalQueue items={items} emptyLabel="Todo al día" />}

      {aAprobar && (
        <Modal titulo="Aprobar precio" onCerrar={cerrar}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-teal">
              {moneda(aAprobar.proposedPrice)} para «{aAprobar.presentation?.producto?.nombre} — {aAprobar.presentation?.nombre}». Elige las tiendas donde aplica desde hoy.
            </p>
            {tiendas.loading && <p className="text-sm text-teal/70">Cargando tiendas…</p>}
            {tiendas.error && <EstadoError mensaje={tiendas.error} onReintentar={tiendas.reintentable ? tiendas.refetch : undefined} />}
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {listaSegura<{ id: string; nombre: string }>(tiendas.data).map((t) => (
                <label key={t.id} className="flex items-center gap-2.5 rounded-full bg-arena px-4 py-2 text-sm text-tinta">
                  <input
                    type="checkbox"
                    checked={tiendasElegidas.includes(t.id)}
                    onChange={(e) => setTiendasElegidas((prev) => (e.target.checked ? [...prev, t.id] : prev.filter((x) => x !== t.id)))}
                  />
                  {t.nombre}
                </label>
              ))}
            </div>
            {errorModal && <ErrorText>{errorModal}</ErrorText>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cerrar} className="rounded-full px-5 py-2.5 text-sm font-bold text-teal hover:bg-arena">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarAprobacion}
                disabled={enProceso}
                className="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-arena hover:bg-vino disabled:opacity-50"
              >
                {enProceso ? 'Aprobando…' : 'Aprobar precio'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {aRechazar && (
        <Modal titulo="Rechazar propuesta" onCerrar={cerrar}>
          <div className="flex flex-col gap-3">
            <TextArea id="motivo-rechazo-precio" label="Motivo (el proveedor lo verá)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            {errorModal && <ErrorText>{errorModal}</ErrorText>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cerrar} className="rounded-full px-5 py-2.5 text-sm font-bold text-teal hover:bg-arena">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarRechazo}
                disabled={enProceso}
                className="rounded-full bg-vino px-5 py-2.5 text-sm font-bold text-arena disabled:opacity-50"
              >
                {enProceso ? 'Rechazando…' : 'Rechazar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <ObservacionesPrecioPanel />
    </div>
  );
}
