import { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  badge?: string;
  description?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, badge, description, action }: SectionHeaderProps) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-3xl text-vino">{title}</h1>
          {badge && (
            <span className="rounded-full bg-salvia/25 px-3 py-1 text-xs font-bold uppercase tracking-wide text-teal">
              {badge}
            </span>
          )}
        </div>
        {description && <p className="mt-1.5 text-sm text-teal/70">{description}</p>}
      </div>
      {action}
    </div>
  );
}
