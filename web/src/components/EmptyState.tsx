interface EmptyStateProps {
  title: string;
  description: string;
}

/** Placeholder honesto (DESIGN.md): sin datos fabricados mientras el módulo no exista. */
export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
      <p className="font-display text-2xl text-teal">{title}</p>
      <p className="max-w-md text-sm text-teal/70">{description}</p>
    </div>
  );
}
