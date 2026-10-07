import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { BasketsService } from './baskets.service';
import { BasketFilterDto } from './dto/basket-filter.dto';
import { ReclassifyBasketsDto } from './dto/reclassify-baskets.dto';
import { ReclassifyBasketDto } from './dto/reclassify-basket.dto';

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

  @Post('reclassify')
  @HttpCode(HttpStatus.OK)
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({
    summary: 'Rellena el segmento de las canastas que nacieron sin él.',
    description:
      'La corrida de clustering (RF-16) clasifica las zonas DESPUÉS de que ya hay ventas: ' +
      'una canasta construida antes nace con `segmentId` nulo y sin esto se queda así para ' +
      'siempre, invisible para el análisis por nivel de ingreso. Solo llena huecos: NO ' +
      'reescribe el segmento de las canastas que ya lo tienen, porque la clasificación se ' +
      'congela al construirlas a propósito (RN-02).',
  })
  @ApiRespuesta(200, 'Canastas pendientes clasificadas.', muestras.reclasificacion)
  @ApiErrores(400, 401, 403)
  reclassify(@Query() filtros: ReclassifyBasketsDto) {
    return this.basketsService.classifyPending(filtros);
  }

  @Post(':id/reclassify')
  @HttpCode(HttpStatus.OK)
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({
    summary: 'Reclasifica UNA canasta contra la clasificación vigente de su zona.',
    description:
      'Refresca el `segmentId`. Con `?resyncZone=true` vuelve a derivar además la zona DESDE ' +
      'LA TIENDA de su transacción, la misma regla que aplica la construcción de la canasta. ' +
      'No es el default porque la zona se congela al construirla a propósito (RN-02): ' +
      're-derivarla reescribiría el análisis de meses pasados si la tienda cambió de zona. ' +
      'Si la tienda no tuviera zona en el catálogo (hoy imposible: `tiendas.zona_id` es NOT ' +
      'NULL), responde 409 en vez de guardar una canasta sin zona.',
  })
  @ApiRespuesta(200, 'Canasta reclasificada.', muestras.canasta)
  @ApiErrores(400, 401, 403, 404, 409)
  reclassifyOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() opciones: ReclassifyBasketDto,
  ) {
    return this.basketsService.classifyByZoneAndSegment(id, opciones);
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
