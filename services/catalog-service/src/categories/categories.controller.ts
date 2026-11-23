import {
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auditar, AuditarInterceptor } from '../common/audit/auditar.interceptor';
import { SessionGuard } from '../common/auth/session.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, ApiSinCuerpo } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

/**
 * T-21 — escrituras de categorías de producto. Son parte del catálogo de productos (M04): las
 * hace el Gerente de categoría. La lectura (`GET /v1/product-categories`) sigue en
 * ProductsController, abierta a todo usuario autenticado.
 */
@ApiTags('M04 Categories')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditarInterceptor)
@Controller('product-categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post()
  @XmlRoot('categoryResponse')
  @Roles(ROL.GERENTE_CATEGORIA)
  @Auditar('categorias_producto', 'insert', 'respuesta')
  @ApiOperation({ summary: 'Crea una categoría (solo Gerente de categoría). Nace activa.' })
  @ApiRespuesta(201, 'Categoría creada.', muestras.categoria, 'categoryResponse')
  @ApiErrores(400, 401, 403, 409)
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @XmlRoot('categoryResponse')
  @Roles(ROL.GERENTE_CATEGORIA)
  @Auditar('categorias_producto', 'update')
  @ApiOperation({ summary: 'Edita una categoría; `activo` la desactiva o reactiva sin borrarla.' })
  @ApiRespuesta(200, 'Categoría actualizada.', muestras.categoria, 'categoryResponse')
  @ApiErrores(400, 401, 403, 404, 409)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @XmlRoot('categoryResponse')
  @Roles(ROL.GERENTE_CATEGORIA)
  @Auditar('categorias_producto', 'delete')
  @ApiOperation({
    summary:
      'Elimina la categoría (204). Si tiene productos o subcategorías NO se borra: queda desactivada y responde 200 con la categoría (D-07).',
  })
  @ApiSinCuerpo(204, 'Eliminada, sin cuerpo (nada dependía de ella).')
  @ApiRespuesta(200, 'Tenía productos o subcategorías: queda desactivada.', { ...muestras.categoria, activo: false }, 'categoryResponse')
  @ApiErrores(400, 401, 403, 404)
  async remove(@Param('id', ParseIntPipe) id: number, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.categories.remove(id);
    if (resultado.eliminado) {
      res.status(204);
      return;
    }
    return resultado.entidad;
  }
}
