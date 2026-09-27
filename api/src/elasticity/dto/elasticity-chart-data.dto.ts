import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CHART_GROUPINGS, ChartGrouping } from './elasticity-filter.dto';
import { ELASTICITY_CLASSES, ElasticityClass } from './elasticity-result.dto';

/** Valor de una barra; todo en null si no hubo datos suficientes. */
export class ElasticityChartValue {
  @ApiProperty({ nullable: true, type: Number })
  value: number | null;

  @ApiProperty({ nullable: true, enum: ELASTICITY_CLASSES })
  classification: ElasticityClass | null;

  @ApiProperty({ description: 'Observaciones que respaldan el valor; 0 si no hubo datos suficientes.' })
  observations: number;

  @ApiProperty({ nullable: true, type: Number })
  rSquared: number | null;
}

/** Una barra del gráfico: una zona o un segmento. */
export class ElasticityChartBar extends ElasticityChartValue {
  @ApiProperty({ description: 'Id de la zona o del segmento.' })
  key: string;

  @ApiProperty({ example: 'Zona Valle' })
  label: string;

  @ApiPropertyOptional({ type: [String], description: 'Solo por segmento: zonas con datos que se promediaron.' })
  zones?: string[];
}

/** M11 — Respuesta de GET /elasticity/chart. */
export class ElasticityChartData {
  @ApiProperty()
  runId: string;

  @ApiProperty()
  presentationId: string;

  @ApiProperty()
  productName: string;

  @ApiProperty()
  presentationName: string;

  @ApiProperty({ enum: CHART_GROUPINGS })
  groupBy: ChartGrouping;

  @ApiProperty()
  periodStart: string;

  @ApiProperty()
  periodEnd: string;

  @ApiProperty({
    type: [ElasticityChartBar],
    description: 'Todas las zonas o segmentos, aunque no tengan valor: así se ve cuáles no tuvieron datos.',
  })
  bars: ElasticityChartBar[];

  @ApiProperty({ nullable: true, type: ElasticityChartValue })
  national: ElasticityChartValue | null;

  @ApiProperty({ example: 'Por segmento: promedio de sus zonas, ponderado por observaciones.' })
  note: string;
}
