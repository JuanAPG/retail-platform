import { RolNombre } from '../types';

/**
 * Quién puede ESCRIBIR en cada recurso: el web no ofrece una acción que el
 * backend va a rechazar con 403. Sale de la Matriz §3
 * (`docs/matriz-perfiles-permisos.md`), que es la fuente: tiendas (M02) y
 * zonas (M03) son Total del Administrador y Lectura para los otros cinco
 * perfiles internos.
 *
 * QA-WEB64-02 queda resuelto: catalog-service tenía las tiendas en el Gerente
 * de categoría y las zonas en el Analista comercial, y se corrigió el servicio
 * para que siga a la Matriz. Si vuelve a haber desacuerdo, se cambia SOLO este
 * mapa (y se arregla el servicio, no la Matriz).
 *
 * `transacciones` cubre M06 y M07 (registro manual, importación CSV y
 * reclasificar canastas): son Total del Analista comercial y Lectura del
 * Administrador. Hace falta porque el Administrador entra al portal del
 * Analista con «Ver como» (`SelectorDePortal`), y sin esto se le ofrecían dos
 * botones que core-process ahora rechaza con 403.
 */
const ESCRIBEN: Record<string, RolNombre[]> = {
  tiendas: ['Administrador'],
  zonas: ['Administrador'],
  transacciones: ['Analista comercial'],
};

export function puedeEscribir(recurso: keyof typeof ESCRIBEN, rol: string | undefined): boolean {
  return !!rol && (ESCRIBEN[recurso] as string[]).includes(rol);
}

export function quienEscribe(recurso: keyof typeof ESCRIBEN): string {
  return ESCRIBEN[recurso].join(' o ');
}
