import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, Pagina, PaginationDto } from './pagination.dto';

/** `paginacion.md`: más allá de esta página se responde 400 (el OFFSET desbordaría en Postgres). */
export const PAGINA_MAXIMA = 1_000_000;

/** Paginación estándar con el tope de página del contrato. */
export class PaginaDto extends PaginationDto {
  @ApiPropertyOptional({ default: PAGINA_DEFAULT, description: 'Página, desde 1 (máximo 1 000 000).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un número entero.' })
  @Min(1, { message: 'page debe ser mayor a 0.' })
  @Max(PAGINA_MAXIMA, { message: `page no puede pasar de ${PAGINA_MAXIMA}.` })
  page?: number;
}

/** `LIMIT`/`OFFSET` de la paginación estándar, para consultas escritas en SQL. */
export function limites(filtros: { page?: number; limit?: number }) {
  const page = filtros.page ?? PAGINA_DEFAULT;
  const limit = Math.min(filtros.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);
  return { page, limit, offset: (page - 1) * limit };
}

export function armarPagina<T>(data: T[], total: number, page: number, limit: number): Pagina<T> {
  return { data, total, page, limit };
}
