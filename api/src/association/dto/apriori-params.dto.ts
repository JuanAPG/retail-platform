import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { AnalyticsFilterDto } from '../../analytics/dto/analytics-filter.dto';

/**
 * M10 — Parámetros de una corrida de Apriori (RF-15).
 *
 * Soporte y confianza son obligatorios: el contrato pide correr Apriori
 * "con soporte/confianza dados", y un default oculto permitiría correr
 * el análisis sin saber con qué umbrales. Quedan guardados en
 * `analisis_corrida_parametros` para reproducir la corrida.
 *
 * Extiende los filtros de M09 para que "canastas de la zona X en agosto"
 * signifique lo mismo en los indicadores y en Apriori.
 */
export class AprioriParamsDto extends AnalyticsFilterDto {
  @ApiProperty({
    example: 0.2,
    description: 'Fracción mínima de canastas en que debe aparecer un conjunto de productos (0.01–1).',
  })
  @IsDefined({ message: 'minSupport es obligatorio.' })
  @IsNumber({}, { message: 'minSupport debe ser un número.' })
  // Con soporte 0 toda combinación es "frecuente" y el cálculo explota.
  @Min(0.01, { message: 'minSupport debe ser al menos 0.01.' })
  @Max(1, { message: 'minSupport no puede ser mayor a 1.' })
  minSupport: number;

  @ApiProperty({
    example: 0.5,
    description: 'Confianza mínima de una regla: P(consecuente | antecedente), 0–1.',
  })
  @IsDefined({ message: 'minConfidence es obligatorio.' })
  @IsNumber({}, { message: 'minConfidence debe ser un número.' })
  @Min(0, { message: 'minConfidence no puede ser negativo.' })
  @Max(1, { message: 'minConfidence no puede ser mayor a 1.' })
  minConfidence: number;

  @ApiPropertyOptional({
    example: 3,
    default: 3,
    description: 'Tamaño máximo de un conjunto de productos (2–4).',
  })
  @IsOptional()
  @IsInt({ message: 'maxItemsetSize debe ser un número entero.' })
  @Min(2, { message: 'maxItemsetSize debe ser al menos 2.' })
  // Reglas de más de 4 productos rara vez son interpretables en retail, y
  // cada nivel extra multiplica las combinaciones a evaluar.
  @Max(4, { message: 'maxItemsetSize no puede ser mayor a 4.' })
  maxItemsetSize?: number;
}
