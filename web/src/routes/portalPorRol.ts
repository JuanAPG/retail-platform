import type { RailPerfil } from '../components/ui/Rail';
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

/** Dos letras para un avatar: "Ana Torres" → "AT", "Planeación" → "PL". */
export function inicialesDeTexto(texto: string): string {
  const palabras = texto.split(' ').filter(Boolean);
  if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase();
  return texto.slice(0, 2).toUpperCase();
}

/**
 * El menú del avatar del Admin lista todos los portales (incluido el
 * suyo, marcado como actual) para que pueda volver a "Administración"
 * sin cerrar sesión. Los demás roles no tienen a dónde cambiar, así que
 * el llamador solo pide esto cuando `esAdmin` es cierto.
 */
export function perfilesParaAdmin(rutaActual: string): RailPerfil[] {
  return PORTALES.map((p) => ({
    rol: p.etiqueta,
    iniciales: inicialesDeTexto(p.etiqueta),
    href: p.ruta,
    actual: p.ruta === rutaActual,
  }));
}
