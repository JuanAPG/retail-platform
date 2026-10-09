import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ElasticityClass } from './elasticity-result.dto';

/** Filtros de GET /v1/elasticity/current, más la paginación estándar. */
export class CurrentElasticityFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Solo esta presentación.' })
  @IsOptional()
  @IsUUID('4', { message: 'presentationId debe ser un UUID válido.' })
  presentationId?: string;

  @ApiPropertyOptional({
    description: 'Solo esta zona, MÁS las filas nacionales (zoneId null): son el respaldo de la simulación.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido.' })
  zoneId?: string;
}

/** Elasticidad vigente de una presentación en una zona (o nacional). */
export interface CurrentElasticity {
  presentationId: string;
  productName: string;
  presentationName: string;
  /** null = agregado nacional. */
  zoneId: string | null;
  zoneName: string;
  value: number;
  classification: ElasticityClass;
  rSquared: number | null;
  observations: number;
  /** Corrida completada más reciente que calculó este valor. */
  runId: string;
  /** Cuándo se ejecutó esa corrida (ISO 8601). */
  executedAt: string;
}
