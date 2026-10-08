import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
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
  @XmlRoot('storeListResponse')
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
  @XmlRoot('postalCodeListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Códigos postales válidos para el alta de tiendas (arreglo plano, sin paginar).' })
  @ApiRespuesta(200, 'Códigos postales con su municipio.', [muestras.codigoPostal])
  @ApiErrores(401, 403)
  findPostalCodes() {
    return this.storesService.findPostalCodes();
  }

  @Get(':id')
  @XmlRoot('storeResponse')
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
  @XmlRoot('storeResponse')
  @Roles(ROL.ADMINISTRADOR)
  @ApiOperation({
    summary:
      'Elimina la tienda y su dirección (204). Si tiene historial (precios, inventario, ventas) NO se borra: queda inactiva y responde 200 con la tienda.',
  })
  @ApiSinCuerpo(204, 'Eliminada, sin cuerpo (no tenía historial).')
  @ApiErrores(400, 401, 403, 404)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.storesService.remove(id);
    if (resultado.eliminado) {
      res.status(204);
      return;
    }
    return resultado.entidad;
  }
}
