import { TextareaHTMLAttributes } from 'react';

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'id'> {
  id: string;
  label: string;
  hint?: string;
}

/** DESIGN.md §5 — mismo lenguaje que Field, en caja (no píldora) por ser multilínea. */
export function TextArea({ id, label, hint, ...textareaProps }: TextAreaProps) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-[13px] font-semibold text-teal">
      {label}
      <textarea
        id={id}
        className="rounded-[28px] border-2 border-transparent bg-arena px-5 py-4 text-[15px] font-normal text-tinta outline-none transition placeholder:text-salvia focus:border-vino focus:bg-marfil hover:border-salvia/60"
        {...textareaProps}
      />
      {hint && <span className="text-xs font-normal text-teal/70">{hint}</span>}
    </label>
  );
}
