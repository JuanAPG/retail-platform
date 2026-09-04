import { useState } from 'react';
import { PortalLayout } from '../components/PortalLayout';
import { SectionHeader } from '../components/SectionHeader';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { useFetch } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { EstatusProductoBadge } from '../components/EstatusProductoBadge';
import { AprobacionesPanel } from './catalogo/AprobacionesPanel';
import { getProductos, getCategorias } from '../api/catalogo';

type Tab =
  | 'productos'
  | 'categorias'
  | 'aprobaciones'
  | 'precios'
  | 'elasticidad'
  | 'comparacion'
  | 'reportes';

export function CatalogoPortal() {
  const { usuario } = useAuth();
  const esGerente = usuario?.rol === 'Gerente de categoría';
  const [tab, setTab] = useState<Tab>('productos');

  const productos = useFetch(getProductos, []);
  const categorias = useFetch(getCategorias, []);

  const sidebarItems = [
    { label: 'Catálogo de productos', active: tab === 'productos', onClick: () => setTab('productos') },
    { label: 'Categorías', active: tab === 'categorias', onClick: () => setTab('categorias') },
    ...(esGerente
      ? [
          {
            label: 'Aprobaciones de proveedor',
            nivel: 'aprueba' as const,
            active: tab === 'aprobaciones',
            onClick: () => setTab('aprobaciones'),
          },
          {
            label: 'Comparar precios',
            active: tab === 'comparacion',
            onClick: () => setTab('comparacion'),
          },
          { label: 'Reportes', active: tab === 'reportes', onClick: () => setTab('reportes') },
        ]
      : [
          {
            label: 'Gestión de precios',
            active: tab === 'precios',
            onClick: () => setTab('precios'),
          },
          {
            label: 'Aprobaciones de precio',
            nivel: 'aprueba' as const,
            active: tab === 'aprobaciones',
            onClick: () => setTab('aprobaciones'),
          },
          {
            label: 'Elasticidad',
            active: tab === 'elasticidad',
            onClick: () => setTab('elasticidad'),
          },
        ]),
  ];

  return (
    <PortalLayout
      breadcrumb={esGerente ? 'Catálogo — Gerente de Categoría' : 'Precios — Responsable de Precios'}
      rolLabel={usuario?.rol ?? ''}
      sidebarItems={sidebarItems}
    >
      {tab === 'productos' && (
        <section>
          <SectionHeader title="Catálogo de productos" description="Productos registrados en la plataforma." />
          {productos.loading && <p className="text-sm text-slate-500">Cargando productos…</p>}
          {productos.error && <p className="text-sm text-rose-600">{productos.error}</p>}
          {productos.data && (
            <DataTable
              rowKey={(p) => p.id}
              rows={productos.data}
              columns={[
                { header: 'SKU', render: (p) => p.sku },
                { header: 'Nombre', render: (p) => p.nombre },
                { header: 'Categoría', render: (p) => p.categoria?.nombre },
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

      {tab === 'categorias' && (
        <section>
          <SectionHeader title="Categorías de producto" description="Taxonomía usada por el catálogo." />
          {categorias.loading && <p className="text-sm text-slate-500">Cargando categorías…</p>}
          {categorias.error && <p className="text-sm text-rose-600">{categorias.error}</p>}
          {categorias.data && (
            <DataTable
              rowKey={(c) => String(c.id)}
              rows={categorias.data}
              columns={[
                { header: 'Nombre', render: (c) => c.nombre },
                { header: 'Descripción', render: (c) => c.descripcion ?? '—' },
              ]}
            />
          )}
        </section>
      )}

      {tab === 'aprobaciones' &&
        (esGerente ? (
          <AprobacionesPanel />
        ) : (
          <section>
            <SectionHeader title="Aprobaciones de precio" badge="APRUEBA" />
            <EmptyState
              title="No hay solicitudes pendientes"
              description="Cuando un proveedor proponga un precio nuevo, aparecerá aquí para tu revisión."
            />
          </section>
        ))}

      {tab === 'precios' && (
        <section>
          <SectionHeader title="Gestión de precios" />
          <EmptyState
            title="Aún no hay precios registrados"
            description="Los precios vigentes por producto y tienda se mostrarán aquí en cuanto se capturen."
          />
        </section>
      )}

      {tab === 'elasticidad' && (
        <section>
          <SectionHeader title="Elasticidad precio-demanda" />
          <EmptyState
            title="Aún no hay cálculos de elasticidad"
            description="Ejecuta un cálculo por producto y zona para ver los resultados aquí."
          />
        </section>
      )}

      {tab === 'comparacion' && (
        <section>
          <SectionHeader title="Comparación de precios entre zonas" />
          <EmptyState
            title="Aún no hay precios que comparar"
            description="En cuanto existan precios vigentes por zona, podrás compararlos aquí."
          />
        </section>
      )}

      {tab === 'reportes' && (
        <section>
          <SectionHeader title="Reportes ejecutivos" />
          <EmptyState
            title="Aún no se ha generado ningún reporte"
            description="Genera un reporte ejecutivo con los hallazgos del análisis comercial."
          />
        </section>
      )}
    </PortalLayout>
  );
}
