import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CatalogoService } from './catalogo.service';

/**
 * Endpoints de SOLO LECTURA para alimentar las pantallas de los
 * portales (Admin, Catálogo, Analista, Auditor, Planeador) con los
 * datos reales sembrados en data_retail.sql.
 *
 * El nivel de acceso por ruta sigue S0_Matriz_de_Perfiles_y_Permisos:
 * un rol en 'Lectura' puede entrar aquí, pero los endpoints de
 * creación/edición/eliminación (Total/Propone/Aprueba) todavía NO
 * existen — se agregan por módulo de negocio en un siguiente paso.
 */
@ApiTags('catalogo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CatalogoController {
  constructor(private readonly catalogoService: CatalogoService) {}

  // `GET /usuarios` vive en UsersController (users.module): ahí está el
  // CRUD completo y la ruta debe tener un solo dueño.

  @Get('tiendas')
  @Roles(
    'Administrador',
    'Analista comercial',
    'Gerente de categoría',
    'Responsable de precios',
    'Planeador',
    'Auditor',
  )
  findTiendas() {
    return this.catalogoService.findTiendas();
  }

  @Get('zonas')
  @Roles(
    'Administrador',
    'Analista comercial',
    'Gerente de categoría',
    'Responsable de precios',
    'Planeador',
    'Auditor',
  )
  findZonas() {
    return this.catalogoService.findZonas();
  }

  // Datos de referencia (catálogo territorial): cualquier usuario
  // autenticado puede consultarlos, sin restricción de rol adicional.
  @Get('municipios')
  findMunicipios() {
    return this.catalogoService.findMunicipios();
  }

  @Get('categorias-producto')
  findCategorias() {
    return this.catalogoService.findCategorias();
  }

  @Get('productos')
  findProductos() {
    return this.catalogoService.findProductos();
  }

  @Get('proveedores')
  @Roles('Administrador', 'Analista comercial', 'Gerente de categoría', 'Auditor')
  findProveedores() {
    return this.catalogoService.findProveedores();
  }
}
