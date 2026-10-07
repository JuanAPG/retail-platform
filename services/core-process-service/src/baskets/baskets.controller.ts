import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
import { ApiErrores, ApiRespuesta, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { BasketsService } from './baskets.service';
import { BasketFilterDto } from './dto/basket-filter.dto';

/**
 * M07 — Canastas. Una por transacción (RN-03), con zona y segmento
 * congelados al momento de construirla.
 */
@ApiTags('v1 Baskets')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('baskets')
export class BasketsController {
  constructor(private readonly basketsService: BasketsService) {}

  @Get()
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Canastas con filtros combinables y paginación.',
    description:
      'Filtros por tienda, zona, segmento, rango de fechas, valor total, número de ' +
      'productos, productos básicos y tamaño de compra. Se combinan con AND ' +
      '(intersección); `dateTo` incluye el día completo. Sin resultados devuelve ' +
      '`data: []`, no error.',
  })
  @ApiRespuesta(200, 'Canastas con filtros combinables.', pagina([muestras.canasta], 100))
  @ApiErrores(400, 401, 403)
  findAll(@Query() filters: BasketFilterDto) {
    return this.basketsService.findAll(filters);
  }

  @Get(':id')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Una canasta con su zona y su transacción.' })
  @ApiRespuesta(200, 'Canasta con zona y transacción.', muestras.canasta)
  @ApiErrores(400, 401, 403, 404)
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.basketsService.findOne(id);
  }
}
