import { ApiProperty } from '@nestjs/swagger';

/**
 * M09 — Una fila de "gasto por categoría". Clase (no interface) para
 * que Swagger pueda documentar la respuesta del endpoint.
 */
export class CategorySpend {
  @ApiProperty({ example: 3 })
  categoryId: number;

  @ApiProperty({ example: 'Lácteos' })
  categoryName: string;

  @ApiProperty({ example: 1520.5, description: 'Suma de subtotales, en MXN.' })
  totalSpend: number;

  @ApiProperty({ example: 42, description: 'Unidades vendidas de la categoría.' })
  units: number;

  @ApiProperty({ example: 18, description: 'Canastas que incluyen la categoría.' })
  basketCount: number;

  @ApiProperty({ example: 23.75, description: 'Porcentaje del gasto total filtrado (0–100).' })
  share: number;
}
