export type NivelPermiso = 'total' | 'lectura' | 'propone' | 'aprueba' | 'lect_act';

export interface SidebarItem {
  label: string;
  nivel?: NivelPermiso;
  active?: boolean;
  onClick?: () => void;
  contador?: number;
}

interface SidebarProps {
  rolLabel: string;
  items: SidebarItem[];
}

const NIVEL_LABEL: Record<NivelPermiso, string> = {
  total: '',
  lectura: 'LECTURA',
  propone: 'PROPONE',
  aprueba: 'APRUEBA',
  lect_act: 'LECT/ACT',
};

const NIVEL_CLASS: Record<NivelPermiso, string> = {
  total: '',
  lectura: 'bg-slate-200 text-slate-500',
  propone: 'bg-amber-100 text-amber-700',
  aprueba: 'bg-slate-800 text-white',
  lect_act: 'bg-slate-200 text-slate-500',
};

export function Sidebar({ rolLabel, items }: SidebarProps) {
  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-slate-50 px-4 py-5">
      <p className="mb-3 px-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        Módulos · {rolLabel}
      </p>
      <nav className="flex flex-col gap-1">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={`flex items-center justify-between rounded px-3 py-2 text-left text-sm transition-colors ${
              item.active
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>{item.label}</span>
            <span className="flex items-center gap-1.5">
              {typeof item.contador === 'number' && (
                <span className="rounded-full bg-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-800">
                  {item.contador}
                </span>
              )}
              {item.nivel && NIVEL_LABEL[item.nivel] && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${NIVEL_CLASS[item.nivel]}`}
                >
                  {NIVEL_LABEL[item.nivel]}
                </span>
              )}
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
