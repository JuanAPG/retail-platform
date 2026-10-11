import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Ningún cuerpo legítimo de la API pasa de 3 niveles; 12 deja holgura y corta lo patológico. */
export const PROFUNDIDAD_MAXIMA = 12;

/** Profundidad de anidamiento de un valor JSON, calculada SIN recursión (un `[[[...]]]` de miles de niveles no la revienta). */
export function profundidad(valor: unknown): number {
  let maxima = 0;
  const pila: Array<[unknown, number]> = [[valor, 1]];
  while (pila.length > 0) {
    const [actual, nivel] = pila.pop() as [unknown, number];
    if (actual === null || typeof actual !== 'object') continue;
    if (nivel > maxima) maxima = nivel;
    if (maxima > PROFUNDIDAD_MAXIMA) return maxima; // ya excede: no hace falta seguir
    for (const hijo of Object.values(actual as object)) pila.push([hijo, nivel + 1]);
  }
  return maxima;
}

/**
 * Rechaza con 400 un cuerpo anidado de forma absurda ANTES del ValidationPipe: `class-transformer` recorre el objeto
 * recursivamente y con ~5 000 niveles lanzaba RangeError (stack overflow), que salía como 500.
 */
@Injectable()
export class ProfundidadPipe implements PipeTransform {
  transform(valor: unknown, metadata: { type: string }) {
    if (metadata.type === 'body' && profundidad(valor) > PROFUNDIDAD_MAXIMA) {
      throw new BadRequestException(`El cuerpo está anidado a más de ${PROFUNDIDAD_MAXIMA} niveles.`);
    }
    return valor;
  }
}
