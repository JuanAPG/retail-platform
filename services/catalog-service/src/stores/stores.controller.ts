import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { StoresService } from './stores.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { StoreFilterDto } from './dto/store-filter.dto';
import { UpdateStoreDto } from './dto/update-store.dto';

/** M02 — Tiendas. Contrato: docs/contratos/catalog-service.md */
@ApiTags('M02 Stores')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @Roles(...PERFILES_INTERNOS)
  findAll(@Query() filtros: StoreFilterDto) {
    return this.storesService.findAll(filtros);
  }

  // Declarada ANTES que ':id', para que 'catalog' no se interprete
  // como un id de tienda.
  @Get('catalog/postal-codes')
  @Roles(...PERFILES_INTERNOS)
  findPostalCodes() {
    return this.storesService.findPostalCodes();
  }

  @Get(':id')
  @Roles(...PERFILES_INTERNOS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.storesService.findOne(id);
  }

  @Post()
  @Roles(ROL.ADMINISTRADOR)
  create(@Body() dto: CreateStoreDto) {
    return this.storesService.create(dto);
  }

  @Patch(':id')
  @Roles(ROL.ADMINISTRADOR)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStoreDto) {
    return this.storesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(ROL.ADMINISTRADOR)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.storesService.remove(id);
  }
}
