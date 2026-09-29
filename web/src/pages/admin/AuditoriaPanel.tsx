import { Hero } from '../../components/ui/Hero';
import { StatusPill } from '../../components/ui/StatusPill';
import { IconAuditoria } from '../../components/ui/icons';

/** M15 — todavía no hay módulo de Auditoría construido; esto es el placeholder de siempre, solo rediseñado. */
export function AuditoriaPanel() {
  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Auditoría"
        subtitle="Bitácora del sistema"
        action={<StatusPill tone="neutral">Solo lectura</StatusPill>}
        decorations={
          <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
            <IconAuditoria className="mt-8 h-[74px] w-[74px]" />
          </div>
        }
      />

      <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
          <IconAuditoria className="h-6 w-6" />
        </span>
        <p className="font-display text-2xl text-teal">Aún no hay eventos de auditoría</p>
        <p className="max-w-sm text-sm text-teal/70">
          La bitácora se llenará conforme el equipo construya los módulos de negocio y se registren operaciones.
        </p>
      </div>
    </div>
  );
}
