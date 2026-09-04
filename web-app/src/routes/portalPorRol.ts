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

/**
 * Catálogo de portales, en el orden en que se le ofrecen al
 * Administrador. Los demás roles solo entran al suyo: esta lista existe
 * para que el Admin pueda recorrer el sistema completo sin tener que
 * cerrar sesión y volver a entrar con otra cuenta.
 */
export interface Portal {
  ruta: string;
  etiqueta: string;
  /** Rol al que pertenece el portal de forma natural. */
  duenio: string;
}

export const PORTALES: Portal[] = [
  { ruta: '/admin', etiqueta: 'Administración', duenio: 'Administrador' },
  { ruta: '/catalogo', etiqueta: 'Catálogo y precios', duenio: 'Gerente de categoría' },
  { ruta: '/analista', etiqueta: 'Análisis comercial', duenio: 'Analista comercial' },
  { ruta: '/planeador', etiqueta: 'Planeación', duenio: 'Planeador' },
  { ruta: '/auditor', etiqueta: 'Auditoría', duenio: 'Auditor' },
  { ruta: '/proveedor', etiqueta: 'Portal del proveedor', duenio: 'Proveedor' },
];
