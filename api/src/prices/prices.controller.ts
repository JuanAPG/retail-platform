import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERFILES_INTERNOS, ROL, UsuarioSolicitante } from '../common/roles';
import { PricesService } from './prices.service';
import { CreatePriceDto } from './dto/create-price.dto';

/**
 * M08 — Precios. Nomenclatura tal como quedó en
 * `Contrato_Metodos_Endpoints` (Sprint 1): en inglés y con las rutas que
 * Leonardo (M11 Elasticidad) y Fernando (M12 Accesibilidad) esperan.
 */
@ApiTags('M08 Prices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('prices')
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  @Post()
  @Roles(ROL.ADMINISTRADOR, ROL.RESPONSABLE_PRECIOS)
  create(@Body() dto: CreatePriceDto, @CurrentUser() usuario: UsuarioSolicitante) {
    return this.pricesService.create(dto, usuario);
  }

  @Get('history')
  @Roles(...PERFILES_INTERNOS)
  @ApiQuery({ name: 'productId', required: true })
  @ApiQuery({ name: 'presentationId', required: false })
  findHistory(
    @Query('productId') productId: string,
    @Query('presentationId') presentationId?: string,
  ) {
    return this.pricesService.findHistory(productId, presentationId);
  }

  @Get('compare-zones')
  @Roles(...PERFILES_INTERNOS)
  @ApiQuery({ name: 'productId', required: true })
  compareAcrossZones(@Query('productId') productId: string) {
    return this.pricesService.compareAcrossZones(productId);
  }
}
