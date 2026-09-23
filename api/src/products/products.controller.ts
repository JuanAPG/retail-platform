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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { APRUEBAN_PRODUCTOS, PERFILES_INTERNOS, ROL, UsuarioSolicitante } from '../common/roles';
import { ProductsService } from './products.service';
import { CrearPropuestaProductoDto } from './dto/crear-propuesta-producto.dto';
import { RechazarProductoDto } from './dto/rechazar-producto.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreatePresentationDto } from './dto/create-presentation.dto';

/**
 * Catálogo de productos y flujo de alta propuesta por proveedor.
 *
 * El acceso está diferenciado en tres niveles distintos, no solo en uno:
 *
 *  1. Por ruta   — `@Roles(...)` decide quién puede siquiera entrar.
 *  2. Por dato   — `GET /productos` devuelve un subconjunto distinto
 *                  según el perfil (un Proveedor solo ve lo suyo).
 *  3. Por acción — leer y escribir se separan: los perfiles de consulta
 *                  (Auditor, Analista, Planeador) no tienen ninguna
 *                  ruta de escritura habilitada aquí.
 */
@ApiTags('M04 Productos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Única lectura abierta a todo usuario autenticado: el Proveedor
  // necesita el catálogo de categorías para elegir una al proponer.
  @Get('categorias-producto')
  findCategorias() {
    return this.productsService.findCategorias();
  }

  // También abierta: el Proveedor la necesita para elegir unidad al
  // registrar la presentación de su propuesta.
  @Get('unidades-medida')
  findUnidadesMedida() {
    return this.productsService.findUnidadesMedida();
  }

  @Get('proveedores')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA, ROL.GERENTE_CATEGORIA, ROL.AUDITOR)
  findProveedores() {
    return this.productsService.findProveedores();
  }

  /**
   * Ruta compartida por todos los perfiles, pero NO devuelve lo mismo a
   * todos: el Proveedor recibe solo los productos de su empresa.
   */
  @Get('productos')
  @ApiOperation({
    summary: 'Catálogo de productos. Un Proveedor recibe únicamente los suyos.',
  })
  findProductos(@CurrentUser() usuario: UsuarioSolicitante) {
    return this.productsService.findProductos(usuario);
  }

  /**
   * Declarada ANTES que cualquier ruta con parámetro, para que
   * 'pendientes' no se interprete como un :id.
   */
  @Get('productos/pendientes')
  @Roles(...APRUEBAN_PRODUCTOS)
  @ApiOperation({ summary: 'Bandeja de propuestas por revisar.' })
  findProductosPendientes() {
    return this.productsService.findProductosPendientes();
  }

  @Post('productos')
  @Roles(ROL.PROVEEDOR)
  @ApiOperation({
    summary:
      'Un Proveedor propone un alta. Nace pendiente y ligada a su propia empresa.',
  })
  crearPropuesta(
    @Body() dto: CrearPropuestaProductoDto,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.productsService.crearPropuesta(dto, usuario);
  }

  /**
   * Alta DIRECTA por Administrador/Gerente — distinta de `crearPropuesta`
   * (esa es del Proveedor y nace pendiente). Ruta separada a propósito:
   * mezclar los dos flujos en un solo POST /productos habría hecho que
   * el mismo endpoint se comportara distinto según quién lo llama, algo
   * que ya evita el resto del controlador (aprobar/rechazar son rutas
   * aparte por la misma razón).
   */
  @Post('productos/alta-directa')
  @Roles(ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA)
  @ApiOperation({ summary: 'Alta directa de un producto, sin pasar por la bandeja de aprobación.' })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch('productos/:id')
  @Roles(ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete('productos/:id')
  @Roles(ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(id);
  }

  // -------------------------------------------------------------------
  // Presentaciones (RF-35)
  // -------------------------------------------------------------------

  @Get('productos/:id/presentaciones')
  @Roles(...PERFILES_INTERNOS)
  findPresentations(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findPresentations(id);
  }

  @Post('productos/:id/presentaciones')
  @Roles(ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA)
  addPresentation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePresentationDto) {
    return this.productsService.addPresentation(id, dto);
  }

  @Delete('presentaciones/:id')
  @Roles(ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA)
  removePresentation(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.removePresentation(id);
  }

  @Patch('productos/:id/aprobar')
  @Roles(...APRUEBAN_PRODUCTOS)
  aprobar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.productsService.aprobar(id, usuario);
  }

  @Patch('productos/:id/rechazar')
  @Roles(...APRUEBAN_PRODUCTOS)
  rechazar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RechazarProductoDto,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.productsService.rechazar(id, dto, usuario);
  }
}
