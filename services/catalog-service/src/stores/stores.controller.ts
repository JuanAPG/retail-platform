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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, ApiSinCuerpo, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
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
  @ApiOperation({ summary: 'Lista paginada de tiendas, por nombre, con dirección, zona y proveedor.' })
  @ApiRespuesta(200, 'Página de tiendas.', pagina([muestras.tienda]))
  @ApiErrores(400, 401, 403)
  findAll(@Query() filtros: StoreFilterDto) {
    return this.storesService.findAll(filtros);
  }

  // Declarada ANTES que ':id', para que 'catalog' no se interprete
  // como un id de tienda.
  @Get('catalog/postal-codes')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Códigos postales válidos para el alta de tiendas (arreglo plano, sin paginar).' })
  @ApiRespuesta(200, 'Códigos postales con su municipio.', [muestras.codigoPostal])
  @ApiErrores(401, 403)
  findPostalCodes() {
    return this.storesService.findPostalCodes();
  }

  @Get(':id')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Detalle de una tienda.' })
  @ApiRespuesta(200, 'La tienda.', muestras.tienda)
  @ApiErrores(400, 401, 403, 404)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.storesService.findOne(id);
  }

  @Post()
  @Roles(ROL.ADMINISTRADOR)
  @ApiOperation({ summary: 'Crea una tienda junto con su dirección (solo Administrador).' })
  @ApiRespuesta(201, 'Tienda creada, activa.', muestras.tienda)
  @ApiErrores(400, 401, 403)
  create(@Body() dto: CreateStoreDto) {
    return this.storesService.create(dto);
  }

  @Patch(':id')
  @Roles(ROL.ADMINISTRADOR)
  @ApiOperation({ summary: 'Edita la tienda y/o su dirección; `activo: false` la desactiva sin borrarla.' })
  @ApiRespuesta(200, 'Tienda actualizada.', muestras.tienda)
  @ApiErrores(400, 401, 403, 404)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStoreDto) {
    return this.storesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(ROL.ADMINISTRADOR)
  @ApiOperation({ summary: 'Elimina la tienda y su dirección. 409 si tiene transacciones (desactívala en su lugar).' })
  @ApiSinCuerpo(204, 'Eliminada, sin cuerpo.')
  @ApiErrores(400, 401, 403, 404, 409)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.storesService.remove(id);
  }
}
