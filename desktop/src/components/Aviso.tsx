import { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';

export type TipoAviso = 'info' | 'exito' | 'error' | 'advertencia';

const ICONO = { info: Info, exito: CircleCheck, error: CircleAlert, advertencia: TriangleAlert } as const;

interface Props {
  tipo?: TipoAviso;
  titulo?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Aviso reutilizable (éxito, error, información, advertencia). Los errores se anuncian a lectores
 * de pantalla de inmediato (`role="alert"`); los demás, con cortesía (`role="status"`).
 */
export default function Aviso({ tipo = 'info', titulo, className, children }: Props) {
  const Icono = ICONO[tipo];
  return (
    <div className={`aviso aviso-${tipo}${className ? ` ${className}` : ''}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <Icono size={18} aria-hidden="true" />
      <div className="aviso-cuerpo">
        {titulo && <strong className="aviso-titulo">{titulo}</strong>}
        {children}
      </div>
    </div>
  );
}
