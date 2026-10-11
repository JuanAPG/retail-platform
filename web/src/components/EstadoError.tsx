interface EstadoErrorProps {
  mensaje: string;
  onReintentar?: () => void;
}

/** Error de una sección: dice qué pasó y deja reintentar sin recargar toda la página. */
export function EstadoError({ mensaje, onReintentar }: EstadoErrorProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-vino/50 py-10 text-center">
      <p className="max-w-md px-4 text-sm font-semibold text-vino">{mensaje}</p>
      {onReintentar && (
        <button
          type="button"
          onClick={onReintentar}
          className="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-arena hover:bg-vino"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
