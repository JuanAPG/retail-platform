import { IconBuscar, IconCampana } from './icons';

interface HeaderBuscador {
  placeholder: string;
  value: string;
  onChange: (valor: string) => void;
}

interface HeaderProps {
  rolLabel: string;
  nombre: string;
  buscador?: HeaderBuscador;
  onNotificaciones?: () => void;
  notificacionesPendientes?: boolean;
}

/** DESIGN.md §4/§5 — Header: rol + saludo, buscador y campana. */
export function Header({ rolLabel, nombre, buscador, onNotificaciones, notificacionesPendientes }: HeaderProps) {
  return (
    <header className="flex items-center gap-4">
      <div className="flex min-w-[260px] flex-col">
        <span className="text-sm font-semibold text-salvia">{rolLabel}</span>
        <span className="font-slab text-[30px] font-extrabold text-vino">Hola, {nombre}</span>
      </div>

      {buscador && (
        <label className="flex h-14 flex-1 items-center gap-3 rounded-full border-2 border-transparent bg-arena px-[22px] text-teal transition focus-within:border-vino focus-within:bg-marfil hover:border-salvia/50">
          <IconBuscar />
          <input
            type="search"
            value={buscador.value}
            onChange={(e) => buscador.onChange(e.target.value)}
            placeholder={buscador.placeholder}
            aria-label={buscador.placeholder}
            className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-tinta outline-none placeholder:text-salvia"
          />
        </label>
      )}

      <button
        type="button"
        onClick={onNotificaciones}
        aria-label="Notificaciones"
        className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-arena text-teal transition hover:-rotate-[8deg] hover:bg-teal hover:text-arena"
      >
        <IconCampana />
        {notificacionesPendientes && (
          <span className="absolute right-3.5 top-3 h-2.5 w-2.5 rounded-full border-2 border-arena bg-vino" />
        )}
      </button>
    </header>
  );
}
