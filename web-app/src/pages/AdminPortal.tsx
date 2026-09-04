import { useState } from 'react';
import { PortalLayout } from '../components/PortalLayout';
import { SectionHeader } from '../components/SectionHeader';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { useFetch } from '../hooks/useFetch';
import { getTiendas, getZonas, getProveedores } from '../api/catalogo';
import { getUsuarios } from '../api/usuarios';
import { BienvenidaPanel, TabAdmin } from './admin/BienvenidaPanel';
import { UsuariosPanel } from './admin/UsuariosPanel';

export function AdminPortal() {
  const [tab, setTab] = useState<TabAdmin>('inicio');

  const usuarios = useFetch(getUsuarios, []);
  const tiendas = useFetch(getTiendas, []);
  const zonas = useFetch(getZonas, []);
  const proveedores = useFetch(getProveedores, []);

  const proveedoresPendientes = proveedores.data?.filter((p) => !p.activo).length;

  const sidebarItems = [
    { label: 'Inicio', active: tab === 'inicio', onClick: () => setTab('inicio') },
    { label: 'Usuarios', active: tab === 'usuarios', onClick: () => setTab('usuarios') },
    { label: 'Tiendas', active: tab === 'tiendas', onClick: () => setTab('tiendas') },
    { label: 'Zonas', active: tab === 'zonas', onClick: () => setTab('zonas') },
    {
      label: 'Proveedores',
      active: tab === 'proveedores',
      onClick: () => setTab('proveedores'),
      contador: proveedoresPendientes || undefined,
    },
    {
      label: 'Auditoría',
      nivel: 'lectura' as const,
      active: tab === 'auditoria',
      onClick: () => setTab('auditoria'),
    },
  ];

  return (
    <PortalLayout breadcrumb="Portal Admin" rolLabel="Administrador" sidebarItems={sidebarItems}>
      {tab === 'inicio' && (
        <BienvenidaPanel
          usuarios={usuarios}
          tiendas={tiendas}
          zonas={zonas}
          proveedores={proveedores}
          onIrA={setTab}
        />
      )}

      {tab === 'usuarios' && <UsuariosPanel estado={usuarios} />}

      {tab === 'tiendas' && (
        <section>
          <SectionHeader title="Tiendas" description="Sucursales físicas registradas." />
          {tiendas.loading && <p className="text-sm text-slate-500">Cargando tiendas…</p>}
          {tiendas.error && <p className="text-sm text-rose-600">{tiendas.error}</p>}
          {tiendas.data && (
            <DataTable
              rowKey={(t) => t.id}
              rows={tiendas.data}
              columns={[
                { header: 'Nombre', render: (t) => t.nombre },
                { header: 'Dirección', render: (t) => t.direccion },
                { header: 'Zona', render: (t) => t.zona?.nombre },
                { header: 'Formato', render: (t) => t.formato },
                {
                  header: 'Estado',
                  render: (t) => (
                    <Badge tone={t.activo ? 'positive' : 'neutral'}>
                      {t.activo ? 'Activo' : 'Inactivo'}
                    </Badge>
                  ),
                },
              ]}
            />
          )}
        </section>
      )}

      {tab === 'zonas' && (
        <section>
          <SectionHeader title="Zonas" description="Zonas geográficas del Área Metropolitana." />
          {zonas.loading && <p className="text-sm text-slate-500">Cargando zonas…</p>}
          {zonas.error && <p className="text-sm text-rose-600">{zonas.error}</p>}
          {zonas.data && (
            <DataTable
              rowKey={(z) => z.id}
              rows={zonas.data}
              columns={[
                { header: 'Nombre', render: (z) => z.nombre },
                { header: 'Municipio', render: (z) => z.municipio?.nombre },
                {
                  header: 'Estado',
                  render: (z) => (
                    <Badge tone={z.activo ? 'positive' : 'neutral'}>
                      {z.activo ? 'Activo' : 'Inactivo'}
                    </Badge>
                  ),
                },
              ]}
            />
          )}
        </section>
      )}

      {tab === 'proveedores' && (
        <section>
          <SectionHeader title="Proveedores" description="Empresas proveedoras registradas." />
          {proveedores.loading && <p className="text-sm text-slate-500">Cargando proveedores…</p>}
          {proveedores.error && <p className="text-sm text-rose-600">{proveedores.error}</p>}
          {proveedores.data && (
            <DataTable
              rowKey={(p) => p.id}
              rows={proveedores.data}
              columns={[
                { header: 'Razón social', render: (p) => p.razonSocial },
                { header: 'RFC', render: (p) => p.rfc ?? '—' },
                { header: 'Correo', render: (p) => p.email },
                {
                  header: 'Estado',
                  render: (p) => (
                    <Badge tone={p.activo ? 'positive' : 'warning'}>
                      {p.activo ? 'Activo' : 'Pendiente de aprobación'}
                    </Badge>
                  ),
                },
              ]}
            />
          )}
        </section>
      )}

      {tab === 'auditoria' && (
        <section>
          <SectionHeader title="Auditoría" badge="SOLO LECTURA" description="Bitácora del sistema." />
          <EmptyState
            title="Aún no hay eventos de auditoría"
            description="La bitácora se llenará conforme el equipo construya los módulos de negocio y se registren operaciones."
          />
        </section>
      )}
    </PortalLayout>
  );
}
