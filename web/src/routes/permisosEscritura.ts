import { RolNombre } from '../types';

/**
 * Quién puede ESCRIBIR en cada recurso según los servicios (no según la matriz
 * de documentación): el web no ofrece una acción que el backend va a rechazar
 * con 403. catalog-service asignó las tiendas al Gerente de categoría y las
 * zonas al Analista comercial; la Matriz §3 las da al Administrador y ese
 * desacuerdo está pendiente de decisión del Product Owner (QA-WEB64-02).
 * Cuando se decida, se cambia SOLO este mapa.
 */
const ESCRIBEN: Record<string, RolNombre[]> = {
  tiendas: ['Gerente de categoría'],
  zonas: ['Analista comercial'],
};

export function puedeEscribir(recurso: keyof typeof ESCRIBEN, rol: string | undefined): boolean {
  return !!rol && (ESCRIBEN[recurso] as string[]).includes(rol);
}

export function quienEscribe(recurso: keyof typeof ESCRIBEN): string {
  return ESCRIBEN[recurso].join(' o ');
}
