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
 * Catálogo de productos y flujo de propuesta por proveedor.
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Única lectura abierta a todo usuario autenticado: el Proveedor
  // necesita el catálogo de categorías para elegir una al proponer.
  @Get('product-categories')
  findCategories() {
    return this.productsService.findCategories();
  }

  // También abierta: el Proveedor la necesita para elegir unidad al
  // registrar la presentación de su propuesta.
  @Get('units')
  findUnits() {
    return this.productsService.findUnits();
  }

  @Get('providers')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA, ROL.GERENTE_CATEGORIA, ROL.AUDITOR)
  findProviders() {
    return this.productsService.findProviders();
  }

  /**
   * Ruta compartida por todos los perfiles, pero NO devuelve lo mismo a
   * todos: el Proveedor recibe solo los productos de su empresa.
   */
  @Get('products')
  @ApiOperation({
    summary: 'Catálogo de productos. Un Proveedor recibe únicamente los suyos.',
  })
  findAll(@CurrentUser() usuario: UsuarioSolicitante) {
    return this.productsService.findAll(usuario);
  }

  /**
   * Declarada ANTES que 'products/:id', para que 'pending' no se
   * interprete como un id de producto.
   */
  @Get('products/pending')
  @Roles(...APRUEBAN_PRODUCTOS)
  @ApiOperation({ summary: 'Bandeja de propuestas por revisar.' })
  findPending() {
    return this.productsService.findPending();
  }

  @Get('products/:id')
  @Roles(...PERFILES_INTERNOS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(id);
  }

  /**
   * Alta DIRECTA por Administrador/Gerente: nace 'activo' de inmediato.
   * Toma la ruta genérica POST /products porque coincide exactamente
   * con `ProductsService.create(dto: CreateProductDto): Product` del
   * Contrato_Metodos_Endpoints; la propuesta del Proveedor (que ya
   * existía antes del Contrato y sigue una lógica distinta: nace
   * pendiente, requiere aprobación) se queda en su propia ruta,
   * `POST /products/proposals`, para no mezclar dos flujos con reglas
   * de negocio distintas en el mismo endpoint.
   */
  @Post('products')
  @Roles(ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA)
  @ApiOperation({ summary: 'Alta directa de un producto, sin pasar por la bandeja de aprobación.' })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Post('products/proposals')
  @Roles(ROL.PROVEEDOR)
  @ApiOperation({
    summary: 'Un Proveedor propone un alta. Nace pendiente y ligada a su propia empresa.',
  })
  createProposal(
    @Body() dto: CrearPropuestaProductoDto,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.productsService.createProposal(dto, usuario);
  }

  @Patch('products/:id')
  @Roles(ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete('products/:id')
  @Roles(ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(id);
  }

  // -------------------------------------------------------------------
  // Presentaciones (RF-35)
  // -------------------------------------------------------------------

  @Get('products/:id/presentations')
  @Roles(...PERFILES_INTERNOS)
  findPresentations(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findPresentations(id);
  }

  @Post('products/:id/presentations')
  @Roles(ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA)
  addPresentation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePresentationDto) {
    return this.productsService.addPresentation(id, dto);
  }

  @Delete('presentations/:id')
  @Roles(ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA)
  removePresentation(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.removePresentation(id);
  }

  @Patch('products/:id/approve')
  @Roles(...APRUEBAN_PRODUCTOS)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() usuario: UsuarioSolicitante) {
    return this.productsService.approve(id, usuario);
  }

  @Patch('products/:id/reject')
  @Roles(...APRUEBAN_PRODUCTOS)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RechazarProductoDto,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.productsService.reject(id, dto, usuario);
  }
}
