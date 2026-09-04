import { RolNombre } from '../types';

export const PORTAL_POR_ROL: Record<RolNombre, string> = {
  Administrador: '/admin',
  'Analista comercial': '/analista',
  'Gerente de categoría': '/catalogo',
  'Responsable de precios': '/catalogo',
  Planeador: '/planeador',
  Auditor: '/auditor',
  Proveedor: '/proveedor',
};

export function portalDelRol(rol: string): string {
  return PORTAL_POR_ROL[rol as RolNombre] ?? '/login';
}
