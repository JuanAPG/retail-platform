import { UseFetchState } from '../../hooks/useFetch';
import { Proveedor } from '../../types';
import { Hero } from '../../components/ui/Hero';
import { Card } from '../../components/ui/Card';
import { StatusPill } from '../../components/ui/StatusPill';
import { IconProveedores } from '../../components/ui/icons';

interface ProveedoresPanelProps {
  estado: UseFetchState<Proveedor[]>;
}

/**
 * Solo lectura por ahora: el backend todavía no expone un endpoint para
 * verificar/rechazar una cuenta de proveedor (solo GET /providers), así
 * que no se agregan botones de Aprobar/Rechazar que no llevarían a
 * ningún lado. La cola de aprobación real vive en el aside del portal.
 */
export function ProveedoresPanel({ estado }: ProveedoresPanelProps) {
  const proveedores = estado.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Proveedores"
        subtitle="Empresas proveedoras registradas"
        decorations={
          <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
            <IconProveedores className="mt-8 h-[74px] w-[74px]" />
          </div>
        }
      />

      {estado.error && (
        <div className="rounded-panel border-2 border-dashed border-vino/40 px-5 py-4">
          <p className="text-sm font-semibold text-vino">No se pudieron cargar los proveedores: {estado.error}</p>
        </div>
      )}

      {estado.data && proveedores.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconProveedores className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">No hay proveedores registrados</p>
        </div>
      )}

      {proveedores.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {proveedores.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-[19px] leading-tight text-tinta">{p.razonSocial}</span>
                <StatusPill tone={p.activo ? 'ok' : 'warn'}>{p.activo ? 'Activo' : 'Pendiente'}</StatusPill>
              </div>
              <div className="flex flex-col gap-0.5 font-data text-xs text-teal">
                <span>{p.rfc ?? 'Sin RFC'}</span>
                <span>{p.email}</span>
                {p.telefono && <span>{p.telefono}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
