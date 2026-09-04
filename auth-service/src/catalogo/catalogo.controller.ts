import {
  Body,
  Controller,
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
import { CatalogoService, UsuarioSolicitante } from './catalogo.service';
import { CrearPropuestaProductoDto } from './dto/crear-propuesta-producto.dto';
import { RechazarProductoDto } from './dto/rechazar-producto.dto';

/** Los seis perfiles internos. El Proveedor es externo y va aparte. */
const PERFILES_INTERNOS = [
  'Administrador',
  'Analista comercial',
  'Gerente de categoría',
  'Responsable de precios',
  'Planeador',
  'Auditor',
] as const;

/** Quién resuelve las propuestas de alta de producto (RN-04, HU-11..HU-16). */
const APRUEBAN_PRODUCTOS = ['Administrador', 'Gerente de categoría'] as const;

/**
 * Catálogo de la plataforma.
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
@ApiTags('catalogo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CatalogoController {
  constructor(private readonly catalogoService: CatalogoService) {}

  // `GET /usuarios` vive en UsersController (users.module): ahí está el
  // CRUD completo y la ruta debe tener un solo dueño.

  // -------------------------------------------------------------------
  // Referencia territorial y taxonomía
  // -------------------------------------------------------------------

  @Get('tiendas')
  @Roles(...PERFILES_INTERNOS)
  findTiendas() {
    return this.catalogoService.findTiendas();
  }

  @Get('zonas')
  @Roles(...PERFILES_INTERNOS)
  findZonas() {
    return this.catalogoService.findZonas();
  }

  @Get('municipios')
  @Roles(...PERFILES_INTERNOS)
  findMunicipios() {
    return this.catalogoService.findMunicipios();
  }

  // Única excepción abierta a todo usuario autenticado: el Proveedor
  // necesita el catálogo de categorías para poder elegir una al
  // proponer un producto.
  @Get('categorias-producto')
  findCategorias() {
    return this.catalogoService.findCategorias();
  }

  @Get('proveedores')
  @Roles('Administrador', 'Analista comercial', 'Gerente de categoría', 'Auditor')
  findProveedores() {
    return this.catalogoService.findProveedores();
  }

  // -------------------------------------------------------------------
  // Productos
  // -------------------------------------------------------------------

  /**
   * Ruta compartida por todos los perfiles, pero NO devuelve lo mismo a
   * todos: el Proveedor recibe solo los productos de su empresa.
   */
  @Get('productos')
  @ApiOperation({
    summary:
      'Catálogo de productos. Un Proveedor recibe únicamente los suyos.',
  })
  findProductos(@CurrentUser() usuario: UsuarioSolicitante) {
    return this.catalogoService.findProductos(usuario);
  }

  /**
   * Declarada ANTES que cualquier ruta con parámetro, para que
   * 'pendientes' no se interprete como un :id.
   */
  @Get('productos/pendientes')
  @Roles(...APRUEBAN_PRODUCTOS)
  @ApiOperation({ summary: 'Bandeja de propuestas por revisar.' })
  findProductosPendientes() {
    return this.catalogoService.findProductosPendientes();
  }

  @Post('productos')
  @Roles('Proveedor')
  @ApiOperation({
    summary:
      'Un Proveedor propone un alta. Nace pendiente y ligada a su propia empresa.',
  })
  crearPropuesta(
    @Body() dto: CrearPropuestaProductoDto,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.catalogoService.crearPropuesta(dto, usuario);
  }

  @Patch('productos/:id/aprobar')
  @Roles(...APRUEBAN_PRODUCTOS)
  aprobar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.catalogoService.aprobar(id, usuario);
  }

  @Patch('productos/:id/rechazar')
  @Roles(...APRUEBAN_PRODUCTOS)
  rechazar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RechazarProductoDto,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.catalogoService.rechazar(id, dto, usuario);
  }
}
