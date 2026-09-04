import { useState } from 'react';
import { PortalLayout } from '../components/PortalLayout';
import { SectionHeader } from '../components/SectionHeader';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { useFetch } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { getProductos } from '../api/catalogo';

type Tab = 'mis-productos' | 'proponer' | 'solicitudes' | 'perfil';

export function ProveedorPortal() {
  const { usuario } = useAuth();
  const [tab, setTab] = useState<Tab>('mis-productos');
  const productos = useFetch(getProductos, []);

  // El backend aún no filtra por proveedor autenticado, así que se
  // filtra en el cliente comparando el correo del proveedor dueño del
  // producto contra el correo de la cuenta con la que se inició sesión
  // (mismo mecanismo de vínculo usuario<->proveedor usado en el registro).
  const misProductos = (productos.data ?? []).filter(
    (p) => p.proveedor?.email === usuario?.email,
  );

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
            description="Productos aprobados asociados a tu empresa. No se puede editar desde este portal."
          />
          {productos.loading && <p className="text-sm text-slate-500">Cargando…</p>}
          {productos.error && <p className="text-sm text-rose-600">{productos.error}</p>}
          {productos.data && misProductos.length === 0 && (
            <EmptyState
              title="Aún no tienes productos en el catálogo"
              description="Cuando propongas un producto y el Gerente de categoría lo apruebe, aparecerá aquí."
            />
          )}
          {misProductos.length > 0 && (
            <DataTable
              rowKey={(p) => p.id}
              rows={misProductos}
              columns={[
                { header: 'SKU', render: (p) => p.sku },
                { header: 'Nombre', render: (p) => p.nombre },
                { header: 'Categoría', render: (p) => p.categoria?.nombre },
                {
                  header: 'Estatus',
                  render: (p) => <Badge tone="positive">{p.estatus}</Badge>,
                },
              ]}
            />
          )}
        </section>
      )}

      {tab === 'proponer' && (
        <section>
          <SectionHeader title="Proponer alta de producto" badge="PROPONE" />
          <EmptyState
            title="El formulario de propuesta aún no está conectado"
            description="Aquí podrás capturar nombre, categoría, presentación y evidencia del producto que quieres ofrecer."
          />
        </section>
      )}

      {tab === 'solicitudes' && (
        <section>
          <SectionHeader title="Mis solicitudes" badge="LECTURA" />
          <EmptyState
            title="No tienes solicitudes registradas"
            description="El estatus de tus productos y precios propuestos aparecerá aquí."
          />
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
