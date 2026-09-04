import { FormEvent, useState } from 'react';
import { PortalLayout } from '../components/PortalLayout';
import { SectionHeader } from '../components/SectionHeader';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EstatusProductoBadge } from '../components/EstatusProductoBadge';
import { EmptyState } from '../components/EmptyState';
import { useFetch } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { getProductos, getCategorias, proponerProducto } from '../api/catalogo';
import { mensajeDeError } from '../api/errores';

type Tab = 'mis-productos' | 'proponer' | 'solicitudes' | 'perfil';

const UNIDADES = ['pieza', 'kg', 'litro', 'paquete'];

export function ProveedorPortal() {
  const { usuario } = useAuth();
  const [tab, setTab] = useState<Tab>('mis-productos');

  // El recorte por empresa lo hace el backend a partir del token: esta
  // respuesta ya viene únicamente con los productos de este proveedor.
  const productos = useFetch(getProductos, []);
  const categorias = useFetch(getCategorias, []);

  const misProductos = productos.data ?? [];
  const enCatalogo = misProductos.filter((p) => p.estatus === 'activo');
  const solicitudes = misProductos.filter((p) => p.estatus !== 'activo');

  const sidebarItems = [
    { label: 'Mis productos', nivel: 'lectura' as const, active: tab === 'mis-productos', onClick: () => setTab('mis-productos') },
    { label: 'Proponer alta de producto', nivel: 'propone' as const, active: tab === 'proponer', onClick: () => setTab('proponer') },
    { label: 'Mis solicitudes', nivel: 'lectura' as const, active: tab === 'solicitudes', onClick: () => setTab('solicitudes') },
    { label: 'Mi perfil', active: tab === 'perfil', onClick: () => setTab('perfil') },
  ];

  return (
    <PortalLayout breadcrumb="Portal del Proveedor" rolLabel="Proveedor Externo" sidebarItems={sidebarItems}>
      {tab === 'mis-productos' && (
        <section>
          <SectionHeader
            title="Mis productos en catálogo"
            badge="SOLO LECTURA"
            description="Productos aprobados de tu empresa. El catálogo de otros proveedores no es visible desde este portal."
          />
          {productos.loading && <p className="text-sm text-slate-500">Cargando…</p>}
          {productos.error && <p className="text-sm text-rose-600">{productos.error}</p>}
          {productos.data && enCatalogo.length === 0 && (
            <EmptyState
              title="Aún no tienes productos en el catálogo"
              description="Cuando propongas un producto y el Gerente de categoría lo apruebe, aparecerá aquí."
            />
          )}
          {enCatalogo.length > 0 && (
            <DataTable
              rowKey={(p) => p.id}
              rows={enCatalogo}
              columns={[
                { header: 'SKU', render: (p) => p.sku },
                { header: 'Nombre', render: (p) => p.nombre },
                { header: 'Categoría', render: (p) => p.categoria?.nombre ?? '—' },
                { header: 'Unidad', render: (p) => p.unidadMedida },
                {
                  header: 'Canasta básica',
                  render: (p) => (p.esCanastaBasica ? <Badge tone="positive">Sí</Badge> : 'No'),
                },
                { header: 'Estatus', render: (p) => <EstatusProductoBadge estatus={p.estatus} /> },
              ]}
            />
          )}
        </section>
      )}

      {tab === 'proponer' && (
        <FormularioPropuesta
          categorias={categorias.data ?? []}
          cargandoCategorias={categorias.loading}
          alGuardar={() => {
            productos.refetch();
            setTab('solicitudes');
          }}
        />
      )}

      {tab === 'solicitudes' && (
        <section>
          <SectionHeader
            title="Mis solicitudes"
            badge="LECTURA"
            description="Propuestas en revisión y resoluciones del Gerente de categoría."
          />
          {productos.loading && <p className="text-sm text-slate-500">Cargando…</p>}
          {productos.data && solicitudes.length === 0 && (
            <EmptyState
              title="No tienes solicitudes registradas"
              description="Usa «Proponer alta de producto» para enviar una propuesta a revisión."
            />
          )}
          {solicitudes.length > 0 && (
            <DataTable
              rowKey={(p) => p.id}
              rows={solicitudes}
              columns={[
                { header: 'SKU', render: (p) => p.sku },
                { header: 'Producto', render: (p) => p.nombre },
                { header: 'Estatus', render: (p) => <EstatusProductoBadge estatus={p.estatus} /> },
                {
                  header: 'Motivo del rechazo',
                  render: (p) => (
                    <span className="text-slate-600">{p.motivoRechazo ?? '—'}</span>
                  ),
                },
              ]}
            />
          )}
        </section>
      )}

      {tab === 'perfil' && (
        <section>
          <SectionHeader title="Mi perfil" />
          <dl className="max-w-md divide-y divide-slate-100 rounded border border-slate-200">
            <div className="flex justify-between px-4 py-3 text-sm">
              <dt className="text-slate-500">Nombre de contacto</dt>
              <dd className="font-medium text-slate-800">{usuario?.nombre}</dd>
            </div>
            <div className="flex justify-between px-4 py-3 text-sm">
              <dt className="text-slate-500">Correo</dt>
              <dd className="font-medium text-slate-800">{usuario?.email}</dd>
            </div>
            <div className="flex justify-between px-4 py-3 text-sm">
              <dt className="text-slate-500">Rol</dt>
              <dd className="font-medium text-slate-800">{usuario?.rol}</dd>
            </div>
          </dl>
        </section>
      )}
    </PortalLayout>
  );
}

interface FormularioPropuestaProps {
  categorias: { id: number; nombre: string }[];
  cargandoCategorias: boolean;
  alGuardar: () => void;
}

function FormularioPropuesta({
  categorias,
  cargandoCategorias,
  alGuardar,
}: FormularioPropuestaProps) {
  const [sku, setSku] = useState('');
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [unidadMedida, setUnidadMedida] = useState(UNIDADES[0]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!categoriaId) {
      setError('Selecciona una categoría.');
      return;
    }

    setEnviando(true);
    try {
      // Nótese que NO se manda proveedorId ni estatus: los pone el
      // backend a partir del token. Mandarlos sería rechazado por el
      // ValidationPipe (forbidNonWhitelisted).
      await proponerProducto({
        sku: sku.trim(),
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
        categoriaId: Number(categoriaId),
        unidadMedida,
      });
      alGuardar();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo enviar la propuesta.'));
    } finally {
      setEnviando(false);
    }
  }

  const inputClass =
    'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none';

  return (
    <section>
      <SectionHeader
        title="Proponer alta de producto"
        badge="PROPONE"
        description="La propuesta queda en revisión del Gerente de categoría. No aparece en el catálogo hasta que la apruebe."
      />

      <form onSubmit={enviar} className="max-w-xl space-y-4">
        {error && (
          <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="sku">
            SKU
          </label>
          <input
            id="sku"
            className={inputClass}
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="BIO-QUI-500"
            maxLength={40}
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            Clave con la que identificas el producto. Debe ser única en la plataforma.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="nombre">
            Nombre del producto
          </label>
          <input
            id="nombre"
            className={inputClass}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={150}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="categoria">
            Categoría
          </label>
          <select
            id="categoria"
            className={inputClass}
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            disabled={cargandoCategorias}
            required
          >
            <option value="">
              {cargandoCategorias ? 'Cargando…' : 'Selecciona una categoría'}
            </option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="unidad">
            Unidad de medida
          </label>
          <select
            id="unidad"
            className={inputClass}
            value={unidadMedida}
            onChange={(e) => setUnidadMedida(e.target.value)}
          >
            {UNIDADES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="descripcion">
            Descripción <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="descripcion"
            className={inputClass}
            rows={3}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={enviando}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {enviando ? 'Enviando…' : 'Enviar propuesta'}
        </button>
      </form>
    </section>
  );
}
