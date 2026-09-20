import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
import { BasketsService } from './baskets.service';
import { BasketFilterDto } from './dto/basket-filter.dto';

@ApiTags('M07 Baskets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('baskets')
export class BasketsController {
  constructor(private readonly basketsService: BasketsService) {}

  @Get()
  @Roles(...PERFILES_INTERNOS)
  findAll(@Query() filters: BasketFilterDto) {
    return this.basketsService.findAll(filters);
  }

  @Get(':id')
  @Roles(...PERFILES_INTERNOS)
  findOne(@Param('id') id: string) {
    return this.basketsService.findOne(id);
  }
}