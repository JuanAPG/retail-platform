import { useAuth } from '../../context/AuthContext';
import { CampanaNotificaciones } from '../CampanaNotificaciones';
import { IconBuscar } from './icons';

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
export function Header({ rolLabel, nombre, buscador }: HeaderProps) {
  const { usuario } = useAuth();
  return (
    <header className="flex flex-wrap items-center gap-4">
      <div className="flex min-w-0 flex-shrink-0 flex-col sm:min-w-[260px]">
        <span className="text-sm font-semibold text-salvia">{rolLabel}</span>
        <span className="font-slab text-[30px] font-extrabold text-vino">Hola, {nombre}</span>
      </div>

      {buscador && (
        <label className="order-3 flex h-14 w-full min-w-[220px] flex-1 items-center gap-3 rounded-full border-2 border-transparent bg-arena px-[22px] text-teal transition focus-within:border-vino focus-within:bg-marfil hover:border-salvia/50 sm:order-none sm:w-auto">
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

      {usuario && <CampanaNotificaciones userId={usuario.id} />}
    </header>
  );
}
