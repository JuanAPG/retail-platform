import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** `respuesta` admite texto (≤ 1000), número finito o booleano. Nada de objetos ni listas. */
@ValidatorConstraint({ name: 'respuestaSimple', async: false })
class RespuestaSimple implements ValidatorConstraintInterface {
  validate(valor: unknown) {
    if (typeof valor === 'string') return valor.length <= 1000;
    if (typeof valor === 'number') return Number.isFinite(valor);
    return typeof valor === 'boolean';
  }
  defaultMessage() {
    return 'respuesta debe ser texto (hasta 1000 caracteres), número o verdadero/falso';
  }
}

/**
 * Una respuesta de encuesta. El catálogo de preguntas NO está definido en
 * ningún documento: se guarda lo que manda el dispositivo (id y texto de la
 * pregunta, y la respuesta) sin inventar preguntas ni validarlas contra una lista.
 */
export class RespuestaEncuestaDto {
  @ApiProperty({ example: 'p-frescura', description: 'Id de la pregunta en el dispositivo (letras, dígitos, ._-; hasta 64).' })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,64}$/, { message: 'preguntaId: letras, dígitos y ._- (1 a 64).' })
  preguntaId!: string;

  @ApiProperty({ example: '¿Los perecederos se ven frescos?', description: 'Texto de la pregunta tal como se mostró (hasta 300).' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  pregunta!: string;

  @ApiProperty({ example: 'si', description: 'Texto (≤ 1000), número o booleano.', oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] })
  @IsDefined({ message: 'respuesta es obligatoria.' })
  @Validate(RespuestaSimple)
  respuesta!: string | number | boolean;
}

/** Cuerpo de `POST /v1/field-visits` (D-30, RF-37 ubicación, RF-38 encuesta). */
export class CreateFieldVisitDto {
  @ApiProperty({
    example: '7c1e2a90-3b4d-4f5e-8a6b-9c0d1e2f3a4b',
    description: 'UUID v4 generado EN EL DISPOSITIVO (D-42). Reenviar la misma visita no crea otra.',
  })
  @IsUUID('4', { message: 'visitId debe ser un UUID v4.' })
  visitId!: string;

  @ApiProperty({ description: 'Tienda visitada (debe existir y estar activa).' })
  @IsUUID('all', { message: 'storeId debe ser un UUID.' })
  storeId!: string;

  @ApiProperty({ example: '2026-11-20T16:05:00Z', description: 'Cuándo se hizo la visita (ISO 8601). No puede ser futura (5 min de margen).' })
  @IsISO8601({ strict: true }, { message: 'visitedAt debe ser una fecha ISO 8601.' })
  visitedAt!: string;

  @ApiProperty({ example: 25.6866, description: 'Latitud del GPS (RF-37), -90 a 90.' })
  @Type(() => Number)
  @IsNumber({}, { message: 'lat debe ser numérico.' })
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: -100.3161, description: 'Longitud del GPS (RF-37), -180 a 180.' })
  @Type(() => Number)
  @IsNumber({}, { message: 'lng debe ser numérico.' })
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({ example: 12, description: 'Precisión del GPS en metros (0 a 10000).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10000)
  accuracyM?: number;

  @ApiPropertyOptional({ type: [RespuestaEncuestaDto], description: 'Respuestas de la encuesta (RF-38), hasta 50.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RespuestaEncuestaDto)
  answers?: RespuestaEncuestaDto[];

  @ApiPropertyOptional({ example: 'Anaquel de lácteos reorganizado.', description: 'Notas libres (hasta 1000).' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
