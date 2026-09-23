import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { EstatusProductoBadge } from '../../components/EstatusProductoBadge';
import { UseFetchState, useFetch } from '../../hooks/useFetch';
import { getCategorias, getUnidadesMedida } from '../../api/catalogo';
import { Producto } from '../../types';
import { ProductoFormModal } from './ProductoFormModal';
import { ConfirmarEliminarProductoModal } from './ConfirmarEliminarProductoModal';
import { PresentacionesModal } from './PresentacionesModal';

interface ProductosPanelProps {
  estado: UseFetchState<Producto[]>;
  /** Solo Admin/Gerente ven y usan las acciones de escritura. */
  puedeGestionar: boolean;
}

/**
 * M04 — Catálogo de productos. El flujo de propuesta de Proveedor
 * (AprobacionesPanel) sigue aparte; aquí vive el alta directa,
 * edición, baja y gestión de presentaciones que le toca a
 * Administrador/Gerente de categoría.
 */
export function ProductosPanel({ estado, puedeGestionar }: ProductosPanelProps) {
  const categorias = useFetch(getCategorias, []);
  const unidadesMedida = useFetch(getUnidadesMedida, []);

  const [formAbierto, setFormAbierto] = useState(false);
  const [productoEditando, setProductoEditando] = useState<Producto | undefined>();
  const [productoAEliminar, setProductoAEliminar] = useState<Producto | null>(null);
  const [productoPresentaciones, setProductoPresentaciones] = useState<Producto | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const productos = estado.data ?? [];

  function cerrarForm() {
    setFormAbierto(false);
    setProductoEditando(undefined);
  }

  function trasGuardar(mensaje: string) {
    cerrarForm();
    setErrorAccion(null);
    setAviso(mensaje);
    estado.refetch();
  }

  const puedeAbrirForm = (categorias.data?.length ?? 0) > 0 && (unidadesMedida.data?.length ?? 0) > 0;

  return (
    <section>
      <SectionHeader
        title="Catálogo de productos"
        description="Productos registrados en la plataforma."
        action={
          puedeGestionar ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={estado.refetch}
                disabled={estado.loading}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {estado.loading ? 'Cargando…' : 'Actualizar'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setProductoEditando(undefined);
                  setFormAbierto(true);
                }}
                disabled={!puedeAbrirForm}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Nuevo producto
              </button>
            </div>
          ) : undefined
        }
      />

      {aviso && (
        <div className="mb-4 flex items-start justify-between gap-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm text-emerald-800">{aviso}</p>
          <button
            type="button"
            onClick={() => setAviso(null)}
            aria-label="Cerrar aviso"
            className="text-sm text-emerald-700 hover:text-emerald-900"
          >
            ✕
          </button>
        </div>
      )}

      {errorAccion && (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm text-rose-700">{errorAccion}</p>
        </div>
      )}

      {estado.loading && <p className="text-sm text-slate-500">Cargando productos…</p>}
      {estado.error && <p className="text-sm text-rose-600">{estado.error}</p>}

      {estado.data && (
        <DataTable
          rowKey={(p) => p.id}
          rows={productos}
          columns={[
            { header: 'SKU', render: (p) => p.sku },
            { header: 'Nombre', render: (p) => p.nombre },
            { header: 'Categoría', render: (p) => p.categoria?.nombre },
            {
              header: 'Canasta básica',
              render: (p) => (p.esCanastaBasica ? <Badge tone="positive">Sí</Badge> : 'No'),
            },
            { header: 'Estatus', render: (p) => <EstatusProductoBadge estatus={p.estatus} /> },
            ...(puedeGestionar
              ? [
                  {
                    header: 'Acciones',
                    render: (p: Producto) => (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setProductoEditando(p);
                            setFormAbierto(true);
                          }}
                          className="text-sm text-slate-600 underline hover:text-slate-900"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setProductoPresentaciones(p)}
                          className="text-sm text-slate-600 underline hover:text-slate-900"
                        >
                          Presentaciones
                        </button>
                        <button
                          type="button"
                          onClick={() => setProductoAEliminar(p)}
                          className="text-sm text-rose-600 underline hover:text-rose-800"
                        >
                          Eliminar
                        </button>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      {formAbierto && categorias.data && unidadesMedida.data && (
        <ProductoFormModal
          producto={productoEditando}
          categorias={categorias.data}
          unidadesMedida={unidadesMedida.data}
          onCerrar={cerrarForm}
          onGuardado={trasGuardar}
        />
      )}

      {productoAEliminar && (
        <ConfirmarEliminarProductoModal
          producto={productoAEliminar}
          onCerrar={() => setProductoAEliminar(null)}
          onEliminado={(mensaje) => {
            setProductoAEliminar(null);
            setErrorAccion(null);
            setAviso(mensaje);
            estado.refetch();
          }}
        />
      )}

      {productoPresentaciones && unidadesMedida.data && (
        <PresentacionesModal
          producto={productoPresentaciones}
          unidadesMedida={unidadesMedida.data}
          onCerrar={() => {
            setProductoPresentaciones(null);
            estado.refetch();
          }}
        />
      )}
    </section>
  );
}
