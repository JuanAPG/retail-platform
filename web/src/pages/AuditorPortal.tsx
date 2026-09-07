import { useState } from 'react';
import { PortalLayout } from '../components/PortalLayout';
import { SectionHeader } from '../components/SectionHeader';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { useFetch } from '../hooks/useFetch';
import { getUsuarios } from '../api/usuarios';

type Tab = 'bitacora' | 'usuarios';

export function AuditorPortal() {
  const [tab, setTab] = useState<Tab>('bitacora');
  const usuarios = useFetch(getUsuarios, []);

  const sidebarItems = [
    { label: 'Bitácora de auditoría', active: tab === 'bitacora', onClick: () => setTab('bitacora') },
    {
      label: 'Usuarios',
      nivel: 'lectura' as const,
      active: tab === 'usuarios',
      onClick: () => setTab('usuarios'),
    },
  ];

  return (
    <PortalLayout breadcrumb="Auditor — Bitácora" rolLabel="Auditor" sidebarItems={sidebarItems}>
      {tab === 'bitacora' && (
        <section>
          <SectionHeader
            title="Bitácora de auditoría"
            badge="SOLO LECTURA"
            description="Registro inmutable de todas las operaciones."
          />
          <EmptyState
            title="Aún no hay eventos registrados"
            description="Conforme se construyan los módulos de negocio y se registren operaciones, aparecerán aquí con usuario, acción y estado previo/posterior."
          />
        </section>
      )}

      {tab === 'usuarios' && (
        <section>
          <SectionHeader title="Usuarios" badge="LECTURA" description="Catálogo de referencia." />
          {usuarios.loading && <p className="text-sm text-slate-500">Cargando…</p>}
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
    </PortalLayout>
  );
}
