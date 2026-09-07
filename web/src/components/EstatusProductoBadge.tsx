import { Badge } from './Badge';
import { EstatusProducto } from '../types';

// Compartido entre el portal de Catálogo y el del Proveedor: los dos
// muestran el mismo estatus y deben nombrarlo igual.
const TONE: Record<EstatusProducto, 'positive' | 'warning' | 'negative' | 'neutral'> = {
  activo: 'positive',
  pendiente_aprobacion: 'warning',
  rechazado: 'negative',
  inactivo: 'neutral',
};

const LABEL: Record<EstatusProducto, string> = {
  activo: 'Activo',
  pendiente_aprobacion: 'Pendiente de aprobación',
  rechazado: 'Rechazado',
  inactivo: 'Inactivo',
};

export function EstatusProductoBadge({ estatus }: { estatus: EstatusProducto }) {
  return <Badge tone={TONE[estatus] ?? 'neutral'}>{LABEL[estatus] ?? estatus}</Badge>;
}
