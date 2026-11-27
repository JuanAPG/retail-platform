import { ReactNode } from 'react';
import { Inbox, LoaderCircle, LucideIcon } from 'lucide-react';

/** Fila de "no hay datos" dentro de una tabla, con ícono y texto. */
export function FilaVacia({ columnas, icono: Icono = Inbox, children }: { columnas: number; icono?: LucideIcon; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={columnas} className="vacio">
        <div className="vacio-contenido">
          <Icono size={28} aria-hidden="true" />
          <span>{children}</span>
        </div>
      </td>
    </tr>
  );
}

/** Estado de carga: texto con indicador y un esqueleto de tabla. */
export function Cargando({ texto = 'Cargando…', filas = 5 }: { texto?: string; filas?: number }) {
  return (
    <div className="cargando" aria-busy="true">
      <span className="cargando-texto" role="status">
        <LoaderCircle size={16} className="girar" aria-hidden="true" />
        {texto}
      </span>
      <div className="esqueleto" aria-hidden="true">
        {Array.from({ length: filas + 1 }, (_, i) => (
          <div key={i} className="esqueleto-fila" style={{ width: i === 0 ? '100%' : `${92 - ((i * 17) % 30)}%` }} />
        ))}
      </div>
    </div>
  );
}
