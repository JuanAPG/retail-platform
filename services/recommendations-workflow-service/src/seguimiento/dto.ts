import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ESTADOS, Estado, METRICAS, Metrica, UNIDADES, Unidad } from './reglas';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (campo: string) => `${campo} debe ser una fecha YYYY-MM-DD`;

/**
 * Los cuerpos NO aceptan `assignedBy`, `evaluatedBy`, `status` ni
 * `variationPct` (§2): el actor sale del token y la variación la calcula el
 * servidor. El `ValidationPipe` (`forbidNonWhitelisted`) los rechaza con 400.
 */

/** `POST /v1/workflow/assignments` (§5). */
export class AsignarDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'recommendationId debe ser un UUID' })
  recommendationId: string;

  @ApiProperty({ format: 'uuid', description: 'Distinto del Gerente que asigna.' })
  @IsUUID('all', { message: 'assigneeUserId debe ser un UUID' })
  assigneeUserId: string;

  @ApiPropertyOptional({ example: '2026-11-15', description: 'Fecha compromiso (día local), ≥ hoy. Solo informativa.' })
  @IsOptional()
  @Matches(FECHA, { message: fecha('dueDate') })
  dueDate?: string;

  @ApiPropertyOptional({ minLength: 10, maxLength: 1000 })
  @IsOptional()
  @IsString({ message: 'note debe tener entre 10 y 1000 caracteres' })
  @Length(10, 1000, { message: 'note debe tener entre 10 y 1000 caracteres' })
  note?: string;
}

/** `PATCH /:id/implement` (§7). */
export class ImplementarDto {
  @ApiPropertyOptional({ example: '2026-11-01', description: 'Por omisión, hoy. Entre el día de startedAt y hoy.' })
  @IsOptional()
  @Matches(FECHA, { message: fecha('implementedOn') })
  implementedOn?: string;

  @ApiProperty({ minLength: 10, maxLength: 1000, description: 'Qué se hizo.' })
  @IsString({ message: 'note es obligatorio: entre 10 y 1000 caracteres' })
  @Length(10, 1000, { message: 'note es obligatorio: entre 10 y 1000 caracteres' })
  note: string;
}

export class AlcanceDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'scope.zoneId debe ser un UUID' })
  zoneId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'scope.storeId debe ser un UUID' })
  storeId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Obligatorio en precio_unitario (D-06).' })
  @IsOptional()
  @IsUUID('all', { message: 'scope.presentationId debe ser un UUID' })
  presentationId?: string;
}

export class PeriodoDto {
  @ApiProperty({ example: '2026-10-02' })
  @Matches(FECHA, { message: 'from debe ser una fecha YYYY-MM-DD' })
  from: string;

  @ApiProperty({ example: '2026-10-31' })
  @Matches(FECHA, { message: 'to debe ser una fecha YYYY-MM-DD' })
  to: string;

  @ApiProperty({ example: 27.5, description: '≥ 0, 2 decimales, en la unidad de `unit`.' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'value debe ser numérico, con máximo 2 decimales' })
  @Min(0, { message: 'value no puede ser negativo' })
  value: number;
}

/** `PATCH /:id/evaluate` (§8). */
export class EvaluarDto {
  @ApiProperty({ enum: METRICAS })
  @IsIn(METRICAS, { message: `metric debe ser uno de: ${METRICAS.join(', ')}` })
  metric: Metrica;

  @ApiProperty({ enum: UNIDADES, description: 'Debe corresponder a la métrica (si no, 400 unidades incompatibles).' })
  @IsIn(UNIDADES, { message: `unit debe ser uno de: ${UNIDADES.join(', ')}` })
  unit: Unidad;

  @ApiProperty({ type: AlcanceDto, description: 'Al menos uno de zoneId, storeId o presentationId.' })
  @IsDefined({ message: 'scope es obligatorio' })
  @IsObject({ message: 'scope debe ser un objeto' })
  @ValidateNested()
  @Type(() => AlcanceDto)
  scope: AlcanceDto;

  @ApiProperty({ type: PeriodoDto })
  @IsDefined({ message: 'before es obligatorio' })
  @IsObject({ message: 'before debe ser un objeto' })
  @ValidateNested()
  @Type(() => PeriodoDto)
  before: PeriodoDto;

  @ApiProperty({ type: PeriodoDto })
  @IsDefined({ message: 'after es obligatorio' })
  @IsObject({ message: 'after debe ser un objeto' })
  @ValidateNested()
  @Type(() => PeriodoDto)
  after: PeriodoDto;

  @ApiProperty({ minLength: 3, maxLength: 300, description: 'Con qué datos se midió (servicio y consulta).' })
  @IsString({ message: 'source es obligatorio: entre 3 y 300 caracteres' })
  @Length(3, 300, { message: 'source es obligatorio: entre 3 y 300 caracteres' })
  source: string;

  @ApiPropertyOptional({ minLength: 10, maxLength: 1000 })
  @IsOptional()
  @IsString({ message: 'comment debe tener entre 10 y 1000 caracteres' })
  @Length(10, 1000, { message: 'comment debe tener entre 10 y 1000 caracteres' })
  comment?: string;
}

/** `GET /v1/workflow/assignments` (§9). */
export class ListarDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ESTADOS })
  @IsOptional()
  @IsIn(ESTADOS, { message: `status debe ser uno de: ${ESTADOS.join(', ')}` })
  status?: Estado;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'assigneeUserId debe ser un UUID' })
  assigneeUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'recommendationId debe ser un UUID' })
  recommendationId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'true: los asignados al usuario del token.' })
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'mine debe ser true o false' })
  mine?: 'true' | 'false';
}
