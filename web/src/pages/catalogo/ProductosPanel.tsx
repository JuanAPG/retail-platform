import { useMemo, useState } from 'react';
import { UseFetchState, useFetch } from '../../hooks/useFetch';
import { getCategorias, getUnidadesMedida } from '../../api/catalogo';
import { EstatusProducto, Producto } from '../../types';
import { Hero } from '../../components/ui/Hero';
import { Card } from '../../components/ui/Card';
import { StatusPill } from '../../components/ui/StatusPill';
import { CircleButton } from '../../components/ui/CircleButton';
import {
  IconCerrar as IconEliminar,
  IconCanastas,
  IconMas,
  IconOjo,
  IconPrecios,
  IconProductos,
} from '../../components/ui/icons';
import { ProductoFormModal } from './ProductoFormModal';
import { ConfirmarEliminarProductoModal } from './ConfirmarEliminarProductoModal';
import { PresentacionesModal } from './PresentacionesModal';

interface ProductosPanelProps {
  estado: UseFetchState<Producto[]>;
  /** Solo Admin/Gerente ven y usan las acciones de escritura. */
  puedeGestionar: boolean;
  busqueda: string;
  onComparar: (producto: Producto) => void;
}

const ESTATUS_TONE: Record<EstatusProducto, 'ok' | 'warn' | 'neutral'> = {
  activo: 'ok',
  pendiente_aprobacion: 'warn',
  rechazado: 'warn',
  inactivo: 'neutral',
};

const ESTATUS_LABEL: Record<EstatusProducto, string> = {
  activo: 'Activo',
  pendiente_aprobacion: 'Pendiente',
  rechazado: 'Rechazado',
  inactivo: 'Inactivo',
};

/**
 * M04 — Catálogo de productos. El flujo de propuesta de Proveedor
 * (AprobacionesPanel) sigue aparte; aquí vive el alta directa,
 * edición, baja y gestión de presentaciones que le toca a
 * Administrador/Gerente de categoría. Responsable de Precios lo ve en
 * solo lectura (RF: Productos, permiso "lectura").
 */
export function ProductosPanel({ estado, puedeGestionar, busqueda, onComparar }: ProductosPanelProps) {
  const categorias = useFetch(getCategorias, []);
  const unidadesMedida = useFetch(getUnidadesMedida, []);

  const [categoriaId, setCategoriaId] = useState<number | 'todos'>('todos');
  const [formAbierto, setFormAbierto] = useState(false);
  const [productoEditando, setProductoEditando] = useState<Producto | undefined>();
  const [productoAEliminar, setProductoAEliminar] = useState<Producto | null>(null);
  const [productoPresentaciones, setProductoPresentaciones] = useState<Producto | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const productos = estado.data ?? [];

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      const coincideTexto = !texto || p.nombre.toLowerCase().includes(texto) || p.sku.toLowerCase().includes(texto);
      const coincideCategoria = categoriaId === 'todos' || p.categoriaId === categoriaId;
      return coincideTexto && coincideCategoria;
    });
  }, [productos, busqueda, categoriaId]);

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
  const canastaBasicaN = productos.filter((p) => p.esCanastaBasica).length;

  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Catálogo"
        subtitle={`${productos.length} ${productos.length === 1 ? 'producto' : 'productos'} en anaquel`}
        action={
          puedeGestionar ? (
            <button
              type="button"
              onClick={() => {
                setProductoEditando(undefined);
                setFormAbierto(true);
              }}
              disabled={!puedeAbrirForm}
              className="group flex h-[52px] items-center gap-2.5 rounded-full bg-vino py-0 pl-4.5 pr-6 text-[15px] font-bold text-arena transition hover:bg-arena hover:text-vino disabled:opacity-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-arena text-vino transition duration-300 group-hover:rotate-90 group-hover:bg-vino group-hover:text-arena">
                <IconMas className="h-[18px] w-[18px]" />
              </span>
              Nuevo producto
            </button>
          ) : undefined
        }
        decorations={
          <>
            <div className="absolute -top-[60px] right-[110px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
              <IconProductos className="mt-8 h-[70px] w-[70px]" />
            </div>
            <div className="absolute right-[22px] top-[18px] flex h-[108px] w-[108px] flex-col items-center justify-center gap-0.5 rounded-full bg-arena text-teal">
              <span className="font-display text-[30px] leading-none">{canastaBasicaN}</span>
              <span className="text-center text-[10px] font-semibold leading-tight">canasta básica</span>
            </div>
            <div className="absolute right-[190px] top-[130px] flex h-[92px] w-[92px] flex-col items-center justify-center gap-0.5 rounded-full bg-marfil text-teal">
              <span className="font-display text-2xl leading-none">{categorias.data?.length ?? '—'}</span>
              <span className="text-[10px] font-semibold">categorías</span>
            </div>
          </>
        }
      />

      {categorias.data && categorias.data.length > 0 && (
        <div className="flex flex-wrap justify-between gap-3 px-1">
          <button
            type="button"
            onClick={() => setCategoriaId('todos')}
            className="flex flex-col items-center gap-2 text-[13px] font-semibold text-teal"
          >
            <span
              className={`flex h-[76px] w-[76px] items-center justify-center rounded-full border-2 transition hover:-translate-y-1.5 ${
                categoriaId === 'todos' ? 'border-vino bg-vino text-arena' : 'border-salvia/35 bg-arena text-teal'
              }`}
            >
              <IconProductos className="h-6 w-6" />
            </span>
            Todo
          </button>
          {categorias.data.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoriaId(c.id)}
              className="flex flex-col items-center gap-2 text-[13px] font-semibold text-teal"
            >
              <span
                className={`flex h-[76px] w-[76px] items-center justify-center rounded-full border-2 transition hover:-translate-y-1.5 ${
                  categoriaId === c.id ? 'border-vino bg-vino text-arena' : 'border-salvia/35 bg-arena text-teal'
                }`}
              >
                <IconProductos className="h-6 w-6" />
              </span>
              <span className="max-w-[92px] truncate">{c.nombre}</span>
            </button>
          ))}
        </div>
      )}

      {aviso && (
        <div className="flex items-center justify-between gap-4 rounded-full bg-salvia/25 px-5 py-3">
          <p className="text-sm font-semibold text-teal">{aviso}</p>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="text-sm text-teal">
            ✕
          </button>
        </div>
      )}
      {errorAccion && (
        <div className="rounded-full bg-vino/10 px-5 py-3">
          <p className="text-sm font-semibold text-vino">{errorAccion}</p>
        </div>
      )}
      {estado.error && (
        <div className="rounded-panel border-2 border-dashed border-vino/40 px-5 py-4">
          <p className="text-sm font-semibold text-vino">No se pudieron cargar los productos: {estado.error}</p>
        </div>
      )}

      <div className="flex items-center justify-between px-1">
        <h2 className="font-display text-[28px] text-vino">
          {categoriaId === 'todos' ? 'Todo el catálogo' : categorias.data?.find((c) => c.id === categoriaId)?.nombre}
        </h2>
        <span className="font-data rounded-full bg-arena px-3.5 py-2 text-[13px] text-teal">
          {filtrados.length} {filtrados.length === 1 ? 'producto' : 'productos'}
        </span>
      </div>

      {estado.data && filtrados.length === 0 && (
        <div className="flex h-[260px] flex-col items-center justify-center gap-3 rounded-panel border-2 border-dashed border-salvia text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-arena text-teal">
            <IconProductos className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">Sin coincidencias</p>
        </div>
      )}

      {filtrados.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtrados.map((p) => (
            <Card
              key={p.id}
              actions={
                <>
                  <CircleButton
                    icon={<IconPrecios className="h-[19px] w-[19px]" />}
                    label={`Comparar precios de ${p.nombre}`}
                    onClick={() => onComparar(p)}
                  />
                  {puedeGestionar && (
                    <>
                      <CircleButton
                        icon={<IconOjo className="h-[19px] w-[19px]" />}
                        label={`Editar ${p.nombre}`}
                        onClick={() => {
                          setProductoEditando(p);
                          setFormAbierto(true);
                        }}
                      />
                      <CircleButton
                        icon={<IconEliminar className="h-[19px] w-[19px]" />}
                        label={`Eliminar ${p.nombre}`}
                        variant="delete"
                        onClick={() => setProductoAEliminar(p)}
                      />
                    </>
                  )}
                </>
              }
            >
              <div className="relative flex h-[136px] items-center justify-center rounded-[24px] bg-salvia/20 text-teal transition group-hover:bg-salvia group-hover:text-tinta">
                <IconProductos className="h-[64px] w-[64px] transition group-hover:scale-[1.12] group-hover:-rotate-[7deg]" />
                <span className="absolute left-2.5 top-2.5">
                  <StatusPill tone={ESTATUS_TONE[p.estatus]}>{ESTATUS_LABEL[p.estatus]}</StatusPill>
                </span>
                {p.esCanastaBasica && (
                  <span
                    title="Canasta básica"
                    className="absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-vino text-arena"
                  >
                    <IconCanastas className="h-[18px] w-[18px]" />
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1 px-1.5">
                <h3 className="font-display text-[19px] leading-tight text-tinta">{p.nombre}</h3>
                <span className="text-[13px] text-teal">{p.categoria?.nombre}</span>
                {p.presentaciones.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.presentaciones.map((pr) => (
                      <span key={pr.id} className="font-data rounded-full bg-marfil px-2.5 py-1 text-[11px] text-teal transition group-hover:bg-teal group-hover:text-arena">
                        {pr.nombre}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center px-1.5">
                <span className="font-data text-xs text-teal">{p.sku}</span>
                {puedeGestionar && (
                  <button
                    type="button"
                    onClick={() => setProductoPresentaciones(p)}
                    className="ml-auto text-xs font-semibold text-teal underline decoration-salvia/60 underline-offset-2 transition hover:text-vino"
                  >
                    Presentaciones
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
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
    </div>
  );
}
