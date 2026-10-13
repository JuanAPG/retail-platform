import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export const ESCENARIOS_MAXIMOS_A_COMPARAR = 20;

/**
 * Acepta las dos formas (`ids=a,b` e `ids=a&ids=b`, o mezcladas) y las deja
 * como una sola lista en minúsculas. Lo que no sea texto (`ids[x]=1`) se
 * devuelve tal cual para que lo rechace la validación con un 400.
 */
function normalizarIds({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return value;
  const partes: unknown[] = Array.isArray(value) ? value : [value];
  if (!partes.every((p): p is string => typeof p === 'string')) return value;
  return (partes as string[])
    .flatMap((p) => p.split(','))
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}

export class CompareScenariosQueryDto {
  @ApiProperty({
    type: [String],
    description: '2 o más UUID de escenario, sin repetir: `ids=a,b` o `ids=a&ids=b`.',
  })
  @Transform(normalizarIds)
  @IsArray({ message: 'ids es obligatorio: indica 2 o más UUID de escenario (ids=a,b o ids=a&ids=b).' })
  @ArrayMinSize(2, { message: 'ids debe traer al menos 2 escenarios.' })
  @ArrayMaxSize(ESCENARIOS_MAXIMOS_A_COMPARAR, {
    message: `ids no puede traer más de ${ESCENARIOS_MAXIMOS_A_COMPARAR} escenarios.`,
  })
  @ArrayUnique({ message: 'ids no debe repetir escenarios.' })
  @IsUUID(undefined, { each: true, message: 'Cada elemento de ids debe ser un UUID válido.' })
  ids: string[];
}
