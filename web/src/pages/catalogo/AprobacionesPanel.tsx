import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { useFetch } from '../../hooks/useFetch';
import {
  getProductosPendientes,
  aprobarProducto,
  rechazarProducto,
} from '../../api/catalogo';
import { mensajeDeError } from '../../api/errores';
import { Producto } from '../../types';

/**
 * Bandeja de revisión del Gerente de categoría: resuelve las altas que
 * proponen los proveedores. La ruta /productos/pendientes responde 403
 * a cualquier otro perfil, así que esta pantalla no es solo un menú
 * escondido — el dato tampoco se entrega.
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

  return (
    <section>
      <SectionHeader
        title="Aprobaciones de proveedor"
        badge="APRUEBA"
        description="Altas propuestas por proveedores externos, pendientes de revisión."
      />

      {aviso && (
        <p className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {aviso}
        </p>
      )}
      {error && (
        <p className="mb-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {pendientes.loading && <p className="text-sm text-slate-500">Cargando propuestas…</p>}
      {pendientes.error && <p className="text-sm text-rose-600">{pendientes.error}</p>}

      {pendientes.data && filas.length === 0 && (
        <EmptyState
          title="No hay solicitudes pendientes"
          description="Cuando un proveedor proponga un producto, aparecerá aquí para tu revisión."
        />
      )}

      {filas.length > 0 && (
        <DataTable
          rowKey={(p) => p.id}
          rows={filas}
          columns={[
            { header: 'SKU', render: (p) => p.sku },
            { header: 'Producto', render: (p) => p.nombre },
            { header: 'Categoría', render: (p) => p.categoria?.nombre ?? '—' },
            {
              header: 'Proveedor',
              render: (p) => p.proveedor?.razonSocial ?? 'Alta interna',
            },
            {
              header: 'Acciones',
              render: (p) => (
                <div className="flex gap-2">
                  <button
                    onClick={() => aprobar(p)}
                    disabled={enProceso === p.id}
                    className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {enProceso === p.id ? 'Aprobando…' : 'Aprobar'}
                  </button>
                  <button
                    onClick={() => setARechazar(p)}
                    disabled={enProceso === p.id}
                    className="rounded border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Rechazar
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

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
    <Modal
      titulo="Rechazar propuesta"
      descripcion={`${producto.sku} — ${producto.nombre}`}
      onCerrar={onCerrar}
    >
      {error && (
        <p className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
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
