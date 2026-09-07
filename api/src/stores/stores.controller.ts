import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
import { StoresService } from './stores.service';

@ApiTags('M02 Tiendas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tiendas')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @Roles(...PERFILES_INTERNOS)
  findAll() {
    return this.storesService.findAll();
  }
}
