import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useFetch } from '../../hooks/useFetch';
import { getProductosPendientes, aprobarProducto, rechazarProducto } from '../../api/catalogo';
import { mensajeDeError } from '../../api/errores';
import { Producto } from '../../types';
import { ApprovalItem, ApprovalQueue } from '../../components/ui/ApprovalQueue';
import { IconPropuesta } from '../../components/ui/icons';

function fechaCorta(iso: string | undefined): string {
  if (!iso) return '—';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(fecha);
}

/**
 * Bandeja de revisión del Gerente de categoría: resuelve las altas que
 * proponen los proveedores. La ruta /productos/pendientes responde 403
 * a cualquier otro perfil, así que esta pantalla no es solo un menú
 * escondido — el dato tampoco se entrega.
 *
 * Nota de fidelidad: Categoria.dc.html muestra tabs "Pendientes /
 * Aprobados / Rechazados" con historial, pero el backend solo expone
 * las pendientes (no hay endpoint de historial todavía) — se muestra
 * solo lo que realmente existe.
 */
export function AprobacionesPanel() {
  const pendientes = useFetch(getProductosPendientes, []);
  const [enProceso, setEnProceso] = useState<string | null>(null);
  const [aRechazar, setARechazar] = useState<Producto | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function aprobar(producto: Producto) {
    setError(null);
    setAviso(null);
    setEnProceso(producto.id);
    try {
      await aprobarProducto(producto.id);
      setAviso(`«${producto.nombre}» quedó aprobado y ya aparece en el catálogo.`);
      pendientes.refetch();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo aprobar el producto.'));
    } finally {
      setEnProceso(null);
    }
  }

  const filas = pendientes.data ?? [];

  const items: ApprovalItem[] = filas.map((p) => ({
    id: p.id,
    avatar: <IconPropuesta className="h-[18px] w-[18px]" />,
    title: p.nombre,
    subtitle: p.proveedor?.razonSocial ?? 'Alta interna',
    approveLabel: enProceso === p.id ? 'Aprobando…' : 'Aprobar alta',
    onApprove: () => aprobar(p),
    onReject: () => setARechazar(p),
    detail: (
      <>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-salvia px-2.5 py-1 text-xs font-semibold text-tinta">
            {p.categoria?.nombre ?? 'Sin categoría'}
          </span>
          <span className="font-data rounded-full bg-arena/[0.14] px-2.5 py-1 text-xs text-arena">
            {fechaCorta(p.createdAt)}
          </span>
          <span className="font-data rounded-full bg-arena/[0.14] px-2.5 py-1 text-xs text-arena">{p.sku}</span>
        </div>
        <p className="text-sm leading-relaxed text-arena">{p.descripcion ?? 'Sin descripción adicional.'}</p>
      </>
    ),
  }));

  return (
    <section className="flex flex-col gap-4 rounded-panel bg-arena p-6">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-slab text-[26px] text-teal">Aprobaciones</h2>
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-vino font-display text-lg text-arena">
          {filas.length}
        </span>
      </div>

      {aviso && (
        <p className="rounded-full bg-salvia/25 px-4 py-2.5 text-sm font-semibold text-teal">{aviso}</p>
      )}
      {error && <p className="rounded-full bg-vino/10 px-4 py-2.5 text-sm font-semibold text-vino">{error}</p>}
      {pendientes.error && <p className="text-sm font-semibold text-vino">{pendientes.error}</p>}

      <ApprovalQueue items={items} emptyLabel="Todo al día" />

      {aRechazar && (
        <ModalRechazo
          producto={aRechazar}
          onCerrar={() => setARechazar(null)}
          onRechazado={(nombre) => {
            setARechazar(null);
            setError(null);
            setAviso(`«${nombre}» fue rechazado. El proveedor verá el motivo en su portal.`);
            pendientes.refetch();
          }}
        />
      )}
    </section>
  );
}

interface ModalRechazoProps {
  producto: Producto;
  onCerrar: () => void;
  onRechazado: (nombre: string) => void;
}

function ModalRechazo({ producto, onCerrar, onRechazado }: ModalRechazoProps) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El backend exige mínimo 10 caracteres y el CHECK del esquema no
  // permite guardar un rechazo sin motivo; se valida aquí también para
  // no gastar un viaje al servidor.
  const motivoValido = motivo.trim().length >= 10;

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      await rechazarProducto(producto.id, motivo.trim());
      onRechazado(producto.nombre);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo rechazar el producto.'));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Rechazar propuesta" descripcion={`${producto.sku} — ${producto.nombre}`} onCerrar={onCerrar}>
      {error && (
        <p className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="motivo">
        Motivo del rechazo
      </label>
      <textarea
        id="motivo"
        rows={4}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        placeholder="Explica qué debe corregir el proveedor para volver a proponerlo."
      />
      <p className="mt-1 text-xs text-slate-500">
        El proveedor verá este texto en «Mis solicitudes». Mínimo 10 caracteres.
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onCerrar}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          onClick={confirmar}
          disabled={!motivoValido || enviando}
          className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {enviando ? 'Rechazando…' : 'Rechazar propuesta'}
        </button>
      </div>
    </Modal>
  );
}
