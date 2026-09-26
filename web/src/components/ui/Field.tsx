import { InputHTMLAttributes, ReactNode } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  id: string;
  label: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  /** Números/datos con `tabular-nums` (SKU, folios, RFC…). */
  dataFont?: boolean;
}

/** DESIGN.md §5 — Campo. */
export function Field({ id, label, icon, trailing, dataFont, ...inputProps }: FieldProps) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-[13px] font-semibold text-teal">
      {label}
      <span className="flex h-14 items-center gap-2.5 rounded-full border-2 border-transparent bg-arena py-0 pl-5 pr-2 text-teal transition focus-within:border-vino focus-within:bg-marfil hover:border-salvia/60">
        {icon}
        <input
          id={id}
          className={`min-w-0 flex-1 border-0 bg-transparent text-[15px] text-tinta outline-none placeholder:text-salvia ${
            dataFont ? 'font-data tabular-nums' : ''
          }`}
          {...inputProps}
        />
        {trailing}
      </span>
    </label>
  );
}
