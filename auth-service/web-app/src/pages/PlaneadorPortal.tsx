import { useState } from 'react';
import { PortalLayout } from '../components/PortalLayout';
import { SectionHeader } from '../components/SectionHeader';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { useFetch } from '../hooks/useFetch';
import { getProductos } from '../api/catalogo';

type Tab = 'nueva' | 'historial' | 'productos';

export function PlaneadorPortal() {
  const [tab, setTab] = useState<Tab>('nueva');
  const productos = useFetch(getProductos, []);

  const sidebarItems = [
    { label: 'Nueva simulación', active: tab === 'nueva', onClick: () => setTab('nueva') },
    { label: 'Historial de simulaciones', active: tab === 'historial', onClick: () => setTab('historial') },
    {
      label: 'Productos',
      nivel: 'lectura' as const,
      active: tab === 'productos',
      onClick: () => setTab('productos'),
    },
  ];

  return (
    <PortalLayout breadcrumb="Planeador — Simulaciones" rolLabel="Planeador" sidebarItems={sidebarItems}>
      {tab === 'nueva' && (
        <section>
          <SectionHeader
            title="Nueva simulación"
            description="Crea y ejecuta escenarios hipotéticos sobre formato, empaque o descuento."
          />
          <EmptyState
            title="El formulario de simulación aún no está conectado"
            description="Esta pantalla mostrará el formulario de parámetros (producto, zona, período, tipo de cambio) en cuanto se construya el módulo de simulaciones."
          />
        </section>
      )}

      {tab === 'historial' && (
        <section>
          <SectionHeader title="Historial de simulaciones" />
          <EmptyState
            title="Aún no has ejecutado ninguna simulación"
            description="Las simulaciones que ejecutes aparecerán aquí con su fecha y resultado."
          />
        </section>
      )}

      {tab === 'productos' && (
        <section>
          <SectionHeader title="Productos" badge="LECTURA" description="Catálogo de referencia." />
          {productos.loading && <p className="text-sm text-slate-500">Cargando…</p>}
          {productos.data && (
            <DataTable
              rowKey={(p) => p.id}
              rows={productos.data}
              columns={[
                { header: 'SKU', render: (p) => p.sku },
                { header: 'Nombre', render: (p) => p.nombre },
                { header: 'Categoría', render: (p) => p.categoria?.nombre },
              ]}
            />
          )}
        </section>
      )}
    </PortalLayout>
  );
}
