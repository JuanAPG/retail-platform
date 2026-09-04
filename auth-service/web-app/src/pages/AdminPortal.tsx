import { useState } from 'react';
import { PortalLayout } from '../components/PortalLayout';
import { SectionHeader } from '../components/SectionHeader';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { useFetch } from '../hooks/useFetch';
import { getUsuarios, getTiendas, getZonas, getProveedores } from '../api/catalogo';

type Tab = 'usuarios' | 'tiendas' | 'zonas' | 'proveedores' | 'auditoria';

export function AdminPortal() {
  const [tab, setTab] = useState<Tab>('usuarios');

  const usuarios = useFetch(getUsuarios, []);
  const tiendas = useFetch(getTiendas, []);
  const zonas = useFetch(getZonas, []);
  const proveedores = useFetch(getProveedores, []);

  const sidebarItems = [
    { label: 'Usuarios', active: tab === 'usuarios', onClick: () => setTab('usuarios') },
    { label: 'Tiendas', active: tab === 'tiendas', onClick: () => setTab('tiendas') },
    { label: 'Zonas', active: tab === 'zonas', onClick: () => setTab('zonas') },
    { label: 'Proveedores', active: tab === 'proveedores', onClick: () => setTab('proveedores') },
    {
      label: 'Auditoría',
      nivel: 'lectura' as const,
      active: tab === 'auditoria',
      onClick: () => setTab('auditoria'),
    },
  ];

  return (
    <PortalLayout breadcrumb="Portal Admin" rolLabel="Administrador" sidebarItems={sidebarItems}>
      {tab === 'usuarios' && (
        <section>
          <SectionHeader
            title="Gestión de Usuarios"
            description="Todos los roles internos del sistema."
          />
          {usuarios.loading && <p className="text-sm text-slate-500">Cargando usuarios…</p>}
          {usuarios.error && <p className="text-sm text-rose-600">{usuarios.error}</p>}
          {usuarios.data && (
            <DataTable
              rowKey={(u) => u.id}
              rows={usuarios.data}
              columns={[
                { header: 'Nombre', render: (u) => u.nombre },
                { header: 'Correo', render: (u) => u.email },
                { header: 'Rol', render: (u) => u.rol },
                {
                  header: 'Estado',
                  render: (u) => (
                    <Badge tone={u.activo ? 'positive' : 'neutral'}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </Badge>
                  ),
                },
              ]}
            />
          )}
        </section>
      )}

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
