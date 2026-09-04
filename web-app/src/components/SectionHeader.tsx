interface SectionHeaderProps {
  title: string;
  badge?: string;
  description?: string;
  action?: React.ReactNode;
}

export function SectionHeader({ title, badge, description, action }: SectionHeaderProps) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          {badge && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
              {badge}
            </span>
          )}
        </div>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
