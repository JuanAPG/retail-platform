import { ReactNode, useState } from 'react';
import { IconCerrar, IconCheck, IconChevron } from './icons';

export interface ApprovalItem {
  id: string;
  avatar: ReactNode;
  title: string;
  subtitle?: string;
  /** Contenido que aparece al expandir: pills, texto, lo que aporte contexto para decidir. */
  detail: ReactNode;
  onApprove: () => void;
  onReject: () => void;
  approveLabel?: string;
}

interface ApprovalQueueProps {
  items: ApprovalItem[];
  emptyLabel: string;
}

/** DESIGN.md §5 — Cola de aprobación: una fila abierta a la vez. */
export function ApprovalQueue({ items, emptyLabel }: ApprovalQueueProps) {
  const [abiertoId, setAbiertoId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3.5 rounded-full bg-marfil/40 p-1.5">
        <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-salvia text-tinta">
          <IconCheck className="h-[18px] w-[18px]" />
        </span>
        <span className="font-display text-xl">{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item) => {
        const abierto = abiertoId === item.id;
        return (
          <div
            key={item.id}
            className={`overflow-hidden rounded-[28px] border-2 transition ${
              abierto ? 'border-teal bg-teal text-arena' : 'border-transparent bg-marfil hover:border-salvia'
            }`}
          >
            <button
              type="button"
              onClick={() => setAbiertoId(abierto ? null : item.id)}
              aria-label={`Ver ${item.title}`}
              className="flex w-full items-center gap-3 px-2.5 py-2.5 text-left"
            >
              <span
                className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full transition ${
                  abierto ? 'bg-vino text-arena' : 'bg-salvia text-tinta'
                }`}
              >
                {item.avatar}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold">{item.title}</span>
                {item.subtitle && <span className="block truncate text-[13px] opacity-80">{item.subtitle}</span>}
              </span>
              <span
                className={`flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full transition ${
                  abierto ? 'rotate-90 bg-arena text-teal' : ''
                }`}
              >
                <IconChevron className="h-[18px] w-[18px]" />
              </span>
            </button>

            {abierto && (
              <div className="flex flex-col gap-3.5 px-4 pb-4 pt-1">
                {item.detail}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={item.onApprove}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-marfil text-sm font-bold text-teal transition hover:bg-vino hover:text-arena"
                  >
                    <IconCheck className="h-[18px] w-[18px]" />
                    {item.approveLabel ?? 'Aprobar'}
                  </button>
                  <button
                    type="button"
                    onClick={item.onReject}
                    aria-label="Rechazar"
                    className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-arena/40 text-arena transition hover:border-vino hover:bg-vino"
                  >
                    <IconCerrar />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
