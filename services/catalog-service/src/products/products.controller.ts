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
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { APRUEBAN_PRODUCTOS, PERFILES_INTERNOS, ROL, VEN_NO_ACTIVOS } from '../common/roles';
import { ApiErrores, ApiRespuesta, ApiSinCuerpo, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { CrearPropuestaProductoDto } from './dto/crear-propuesta-producto.dto';
import { CreatePresentationDto } from './dto/create-presentation.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductFilterDto } from './dto/product-filter.dto';
import { RechazarProductoDto } from './dto/rechazar-producto.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

/**
 * Catálogo de productos y presentaciones. Contrato:
 * docs/contratos/catalog-service.md
 *
 * El acceso está diferenciado en tres niveles distintos, no solo en uno:
 *
 *  1. Por ruta   — `@Roles(...)` decide quién puede siquiera entrar.
 *  2. Por dato   — `GET /products` devuelve un subconjunto distinto
 *                  según el perfil (un Proveedor solo ve lo suyo).
 *  3. Por acción — leer y escribir se separan: los perfiles de consulta
 *                  (Auditor, Analista, Planeador) no tienen ninguna
 *                  ruta de escritura habilitada aquí.
 */
@ApiTags('M04 Products')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Única lectura abierta a todo usuario autenticado: el Proveedor
  // necesita el catálogo de categorías para elegir una al proponer.
  @Get('product-categories')
  @XmlRoot('categoryListResponse')
  @ApiOperation({ summary: 'Catálogo de categorías (arreglo plano, sin paginar). Abierto a todo usuario autenticado.' })
  @ApiRespuesta(200, 'Categorías ordenadas por nombre.', [muestras.categoria])
  @ApiErrores(401)
  findCategories() {
    return this.productsService.findCategories();
  }

  // También abierta: el Proveedor la necesita para elegir unidad al
  // registrar la presentación de su propuesta.
  @Get('units')
  @XmlRoot('unitListResponse')
  @ApiOperation({ summary: 'Catálogo de unidades de medida (arreglo plano, sin paginar). Abierto a todo usuario autenticado.' })
  @ApiRespuesta(200, 'Unidades ordenadas por clave.', [muestras.unidad])
  @ApiErrores(401)
  findUnits() {
    return this.productsService.findUnits();
  }

  @Get('providers')
  @XmlRoot('supplierListResponse')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA, ROL.GERENTE_CATEGORIA, ROL.AUDITOR)
  @ApiOperation({ summary: 'Padrón de empresas proveedoras, paginado por razón social (solo lectura).' })
  @ApiRespuesta(200, 'Página de proveedores.', pagina([muestras.proveedor]))
  @ApiErrores(400, 401, 403)
  findProviders(@Query() filtros: ProductFilterDto) {
    return this.productsService.findProviders(filtros);
  }

  /**
   * Ruta compartida por todos los perfiles, pero NO devuelve lo mismo a
   * todos: el Proveedor recibe solo los productos de su empresa.
   */
  @Get('products')
  @XmlRoot('productListResponse')
  @ApiOperation({
    summary: 'Catálogo de productos, paginado por nombre. Un Proveedor recibe únicamente los suyos.',
  })
  @ApiRespuesta(200, 'Página de productos con sus presentaciones.', pagina([muestras.producto]))
  @ApiErrores(400, 401, 403)
  findAll(@CurrentUser() usuario: SesionUsuario, @Query() filtros: ProductFilterDto) {
    return this.productsService.findAll(usuario, filtros);
  }

  /**
   * Declarada ANTES que 'products/:id', para que 'pending' no se
   * interprete como un id de producto.
   */
  @Get('products/pending')
  @XmlRoot('productListResponse')
  @Roles(...VEN_NO_ACTIVOS)
  @ApiOperation({ summary: 'Bandeja de propuestas por revisar, las más antiguas primero.' })
  @ApiRespuesta(200, 'Página de propuestas pendientes.', pagina([muestras.productoPendiente]))
  @ApiErrores(400, 401, 403)
  findPending(@Query() filtros: ProductFilterDto) {
    return this.productsService.findPending(filtros);
  }

  @Get('products/:id')
  @XmlRoot('productResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Detalle de un producto con sus presentaciones.' })
  @ApiRespuesta(200, 'El producto.', muestras.producto)
  @ApiErrores(400, 401, 403, 404)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() usuario: SesionUsuario) {
    return this.productsService.findOneVisible(id, usuario);
  }

  /**
   * Alta DIRECTA por Administrador/Gerente: nace 'activo' de inmediato.
   * La propuesta del Proveedor (nace pendiente, requiere aprobación) va
   * en su propia ruta para no mezclar dos flujos con reglas distintas.
   */
  @Post('products')
  @Roles(ROL.GERENTE_CATEGORIA)
  @ApiOperation({ summary: 'Alta directa de un producto con su primera presentación, sin pasar por la bandeja de aprobación.' })
  @ApiRespuesta(201, 'Producto creado, activo.', muestras.producto)
  @ApiErrores(400, 401, 403, 409)
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Post('products/proposals')
  @Roles(ROL.PROVEEDOR)
  @ApiOperation({
    summary: 'Un Proveedor propone un alta. Nace pendiente y ligada a su propia empresa (no acepta proveedorId, estatus ni esCanastaBasica).',
  })
  @ApiRespuesta(201, 'Propuesta registrada, pendiente de aprobación.', muestras.productoPendiente)
  @ApiErrores(400, 401, 403, 409)
  createProposal(@Body() dto: CrearPropuestaProductoDto, @CurrentUser() usuario: SesionUsuario) {
    return this.productsService.createProposal(dto, usuario);
  }

  @Patch('products/:id')
  @Roles(ROL.GERENTE_CATEGORIA)
  @ApiOperation({ summary: 'Edita nombre, descripción, categoría o canasta básica. No acepta estatus.' })
  @ApiRespuesta(200, 'Producto actualizado.', muestras.producto)
  @ApiErrores(400, 401, 403, 404)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete('products/:id')
  @XmlRoot('productResponse')
  @Roles(ROL.GERENTE_CATEGORIA)
  @ApiOperation({
    summary:
      'Elimina el producto (204). Si alguna presentación tiene historial (precios, inventario, ventas) NO se borra: queda inactivo y responde 200 con el producto.',
  })
  @ApiSinCuerpo(204, 'Eliminado, sin cuerpo (no tenía historial).')
  @ApiErrores(400, 401, 403, 404)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.productsService.remove(id);
    if (resultado.eliminado) {
      res.status(204);
      return;
    }
    return resultado.entidad;
  }

  @Patch('products/:id/approve')
  @Roles(...APRUEBAN_PRODUCTOS)
  @ApiOperation({ summary: 'Aprueba una propuesta pendiente y registra quién y cuándo.' })
  @ApiRespuesta(200, 'Producto activo.', muestras.producto)
  @ApiErrores(400, 401, 403, 404, 409)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() usuario: SesionUsuario) {
    return this.productsService.approve(id, usuario);
  }

  @Patch('products/:id/reject')
  @Roles(...APRUEBAN_PRODUCTOS)
  @ApiOperation({ summary: 'Rechaza una propuesta pendiente; exige motivo de al menos 10 caracteres.' })
  @ApiRespuesta(200, 'Producto rechazado.', { ...muestras.productoPendiente, estatus: 'rechazado' })
  @ApiErrores(400, 401, 403, 404, 409)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RechazarProductoDto,
    @CurrentUser() usuario: SesionUsuario,
  ) {
    return this.productsService.reject(id, dto, usuario);
  }

  // -------------------------------------------------------------------
  // Presentaciones (RF-35)
  // -------------------------------------------------------------------

  @Get('products/:id/presentations')
  @XmlRoot('presentationListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Presentaciones de un producto (arreglo plano, sin paginar).' })
  @ApiRespuesta(200, 'Presentaciones ordenadas por nombre.', [muestras.presentacion])
  @ApiErrores(400, 401, 403, 404)
  findPresentations(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() usuario: SesionUsuario) {
    return this.productsService.findPresentations(id, usuario);
  }

  @Post('products/:id/presentations')
  @Roles(ROL.GERENTE_CATEGORIA)
  @ApiOperation({ summary: 'Agrega una presentación. 409 si ya hay otra predeterminada.' })
  @ApiRespuesta(201, 'Presentación creada.', muestras.presentacion)
  @ApiErrores(400, 401, 403, 404, 409)
  addPresentation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePresentationDto) {
    return this.productsService.addPresentation(id, dto);
  }

  @Delete('presentations/:id')
  @XmlRoot('presentationResponse')
  @Roles(ROL.GERENTE_CATEGORIA)
  @ApiOperation({
    summary:
      'Elimina una presentación (204). Si tiene historial (precios, inventario, ventas) NO se borra: queda inactiva y responde 200 con la presentación.',
  })
  @ApiSinCuerpo(204, 'Eliminada, sin cuerpo (no tenía historial).')
  @ApiErrores(400, 401, 403, 404)
  async removePresentation(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.productsService.removePresentation(id);
    if (resultado.eliminado) {
      res.status(204);
      return;
    }
    return resultado.entidad;
  }
}
