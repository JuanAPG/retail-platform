import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
import { ApiErrores, ApiRespuesta } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { BasketsService } from './baskets.service';
import { BasketFilterDto } from './dto/basket-filter.dto';

@ApiTags('v1 Baskets')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('baskets')
export class BasketsController {
  constructor(private readonly basketsService: BasketsService) {}

  @Get()
  @Roles(...PERFILES_INTERNOS)
  @ApiRespuesta(200, 'Canastas con filtros combinables.', [muestras.canasta])
  @ApiErrores(401, 403)
  findAll(@Query() filters: BasketFilterDto) {
    return this.basketsService.findAll(filters);
  }

  @Get(':id')
  @Roles(...PERFILES_INTERNOS)
  @ApiRespuesta(200, 'Canasta con zona y transacción.', muestras.canasta)
  @ApiErrores(401, 403, 404)
  findOne(@Param('id') id: string) {
    return this.basketsService.findOne(id);
  }
}
