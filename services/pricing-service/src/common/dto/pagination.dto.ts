import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Defaults congelados en `docs/contratos/paginacion.md`. */
export const PAGINA_DEFAULT = 1;
export const LIMITE_DEFAULT = 20;
export const LIMITE_MAXIMO = 100;
/** Tope de `page`: más allá, el OFFSET desborda el bigint de Postgres y daba 500. */
export const PAGINA_MAXIMA = 1_000_000;

/**
 * Paginación estándar — NO CAMBIAR sus nombres ni defaults.
 * Todo endpoint de lista de los 10 microservicios la acepta:
 * `?page=2&limit=20`. Los catálogos chicos que no paginan lo declaran
 * como excepción en su contrato.
 */
export class PaginationDto {
  @ApiPropertyOptional({ default: PAGINA_DEFAULT, description: 'Página, desde 1.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un número entero.' })
  @Min(1, { message: 'page debe ser mayor a 0.' })
  @Max(PAGINA_MAXIMA, { message: `page no puede pasar de ${PAGINA_MAXIMA}.` })
  page?: number;

  @ApiPropertyOptional({ default: LIMITE_DEFAULT, description: 'Filas por página (mayor a 100 se recorta a 100).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un número entero.' })
  @Min(1, { message: 'limit debe ser mayor a 0.' })
  limit?: number;
}

/** Envoltura estándar de toda respuesta paginada (JSON y XML). */
export interface Pagina<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
