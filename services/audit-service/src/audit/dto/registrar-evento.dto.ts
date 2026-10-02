import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { AccionAuditoria } from '../../entities/auditoria.entity';

const ACCIONES: AccionAuditoria[] = ['insert', 'update', 'delete', 'login', 'importacion'];

export class CambioDto {
  @IsString()
  campo: string;

  @IsOptional()
  @IsString()
  previo?: string | null;

  @IsOptional()
  @IsString()
  posterior?: string | null;
}

/**
 * Evento que reporta otro microservicio. Solo `tabla` y `accion` son
 * obligatorios: un evento sin actor o sin registro igual queda.
 */
export class RegistrarEventoDto {
  @IsString()
  tabla: string;

  @IsOptional()
  @IsString()
  registroId?: string;

  @IsIn(ACCIONES, { message: 'accion debe ser insert, update, delete, login o importacion.' })
  accion: AccionAuditoria;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CambioDto)
  cambios?: CambioDto[];

  @IsOptional()
  @IsUUID('4')
  usuarioId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rolId?: number;

  @IsOptional()
  @IsString()
  ip?: string;
}
