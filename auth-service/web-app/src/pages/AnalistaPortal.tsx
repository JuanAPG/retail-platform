import { useState } from 'react';
import { PortalLayout } from '../components/PortalLayout';
import { SectionHeader } from '../components/SectionHeader';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { useFetch } from '../hooks/useFetch';
import { getTiendas, getProductos } from '../api/catalogo';

type Tab =
  | 'transacciones'
  | 'segmentos'
  | 'canastas'
  | 'reglas'
  | 'accesibilidad'
  | 'productos'
  | 'tiendas';

export function AnalistaPortal() {
  const [tab, setTab] = useState<Tab>('transacciones');
  const tiendas = useFetch(getTiendas, []);
  const productos = useFetch(getProductos, []);

  const sidebarItems = [
    { label: 'Transacciones', active: tab === 'transacciones', onClick: () => setTab('transacciones') },
    { label: 'Segmentos de ingreso', active: tab === 'segmentos', onClick: () => setTab('segmentos') },
    { label: 'Canastas', active: tab === 'canastas', onClick: () => setTab('canastas') },
    { label: 'Reglas de asociación', active: tab === 'reglas', onClick: () => setTab('reglas') },
    {
      label: 'Indicadores de accesibilidad',
      active: tab === 'accesibilidad',
      onClick: () => setTab('accesibilidad'),
    },
    { label: 'Productos', nivel: 'lectura' as const, active: tab === 'productos', onClick: () => setTab('productos') },
    { label: 'Tiendas', nivel: 'lectura' as const, active: tab === 'tiendas', onClick: () => setTab('tiendas') },
  ];

  return (
    <PortalLayout breadcrumb="Portal del Analista" rolLabel="Analista comercial" sidebarItems={sidebarItems}>
      {tab === 'transacciones' && (
        <section>
          <SectionHeader title="Transacciones" description="Registro de operaciones en tiendas." />
          <EmptyState
            title="Aún no hay transacciones registradas"
            description="Importa un lote de transacciones o registra una manualmente para empezar a construir canastas e indicadores."
          />
        </section>
      )}

      {tab === 'segmentos' && (
        <section>
          <SectionHeader title="Segmentos de ingreso" />
          <EmptyState
            title="Aún no hay segmentos configurados"
            description="Define rangos de ingreso para clasificar zonas y canastas por capacidad de compra."
          />
        </section>
      )}

      {tab === 'canastas' && (
        <section>
          <SectionHeader title="Canastas de consumo" />
          <EmptyState
            title="Aún no se ha generado ninguna canasta"
            description="Las canastas se construyen a partir de las transacciones registradas."
          />
        </section>
      )}

      {tab === 'reglas' && (
        <section>
          <SectionHeader title="Reglas de asociación" />
          <EmptyState
            title="Aún no se ha ejecutado ningún análisis"
            description="Corre Apriori o FP-Growth sobre las canastas para descubrir productos que se compran juntos."
          />
        </section>
      )}

      {tab === 'accesibilidad' && (
        <section>
          <SectionHeader title="Indicadores de accesibilidad" />
          <EmptyState
            title="Aún no hay indicadores calculados"
            description="Calcula el índice de accesibilidad económica por zona y segmento."
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

      {tab === 'tiendas' && (
        <section>
          <SectionHeader title="Tiendas" badge="LECTURA" description="Catálogo de referencia." />
          {tiendas.loading && <p className="text-sm text-slate-500">Cargando…</p>}
          {tiendas.data && (
            <DataTable
              rowKey={(t) => t.id}
              rows={tiendas.data}
              columns={[
                { header: 'Nombre', render: (t) => t.nombre },
                { header: 'Zona', render: (t) => t.zona?.nombre },
                { header: 'Formato', render: (t) => t.formato },
              ]}
            />
          )}
        </section>
      )}
    </PortalLayout>
  );
}
