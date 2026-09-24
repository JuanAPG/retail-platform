import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { StoresService } from './stores.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';

@ApiTags('M02 Stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @Roles(...PERFILES_INTERNOS)
  findAll() {
    return this.storesService.findAll();
  }

  // Declarada ANTES que ':id', para que 'catalog' no se interprete
  // como un id de tienda (mismo truco que /products/pending en M04).
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
  @Roles(ROL.ADMINISTRADOR)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.storesService.remove(id);
  }
}
