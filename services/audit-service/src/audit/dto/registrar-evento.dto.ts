import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AccionAuditoria } from '../../entities/auditoria.entity';

export const ACCIONES: AccionAuditoria[] = [
  'insert',
  'update',
  'delete',
  'login',
  'importacion',
  'aprobar',
  'rechazar',
  'desactivar',
  'ejecutar_corrida',
  'simular',
  'generar_recomendacion',
  'exportar',
];

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
 * Evento que reporta otro microservicio. `tabla`, `servicio` y `accion`
 * son obligatorios: un evento sin ellos no dice quién reportó qué.
 *
 * `usuarioId` y `rolId` NO están aquí a propósito: el actor SIEMPRE sale
 * del token verificado por `SessionGuard` en el controller, nunca del
 * cuerpo (`forbidNonWhitelisted` responde 400 si alguien los manda,
 * para no poder falsificar quién hizo qué).
 */
export class RegistrarEventoDto {
  @IsString()
  tabla: string;

  @IsOptional()
  @IsString()
  registroId?: string;

  /** Nombre del microservicio emisor, p. ej. `pricing-service`. */
  @IsString()
  @MaxLength(40, { message: 'servicio no puede tener más de 40 caracteres.' })
  servicio: string;

  @IsIn(ACCIONES, {
    message: `accion debe ser una de: ${ACCIONES.join(', ')}.`,
  })
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
  @IsString()
  ip?: string;
}
