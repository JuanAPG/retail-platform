import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { NivelPermiso } from '../../entities/rol-modulo-permiso.entity';

const NIVELES: NivelPermiso[] = [
  'total',
  'lectura_actualiza',
  'lectura',
  'propone',
  'aprueba',
  'lectura_propios',
  'sin_acceso',
];

export class PermisoDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  moduloId?: number;

  @IsOptional()
  @IsString()
  clave?: string;

  @IsIn(NIVELES, { message: 'nivel no es válido.' })
  nivel: NivelPermiso;
}

/** Reemplaza la matriz completa de un rol (se borra y se reescribe). */
export class ReemplazarMatrizDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermisoDto)
  permisos: PermisoDto[];
}
