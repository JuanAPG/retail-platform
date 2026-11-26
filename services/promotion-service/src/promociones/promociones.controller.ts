import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { MensajeProhibido, Roles, RolesGuard, UsuarioActual } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { CuerpoXmlInterceptor } from '../common/xml/cuerpo-xml';
import { CompararPromocionesDto, CrearPromocionDto, ListarPromocionesDto, PrecioUnitarioDto, RechazarPromocionDto } from './dto';
import { EJEMPLOS } from './ejemplos';
import { PromocionesService, Solicitante } from './promociones.service';

/** `:id` es UUID; otro valor → 400 (§1). */
const ID = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException(':id debe ser un UUID') });

/**
 * Promociones (D-39). Permisos de §2: proponer solo el Gerente de categoría;
 * aprobar y rechazar solo el Responsable de precios (ni el Administrador);
 * leer, los 6 perfiles internos. Proveedor e Investigador → 403 en todo.
 * Los guards corren ANTES de interpretar el cuerpo XML (`CuerpoXmlInterceptor`).
 */
@ApiTags('promotions')
@ApiBearerAuth()
@ApiProduces('application/json', 'application/xml')
@UseGuards(SessionGuard, RolesGuard)
@Roles(...PERFILES_INTERNOS)
@MensajeProhibido('Tu rol no tiene acceso a promociones.')
@Controller('promotions')
export class PromocionesController {
  constructor(private readonly promociones: PromocionesService) {}

  @Post()
  @XmlRoot('promocionResponse')
  @Roles(ROL.GERENTE_CATEGORIA)
  @MensajeProhibido('Solo el Gerente de categoría propone promociones.')
  @UseInterceptors(
    new CuerpoXmlInterceptor({ raiz: 'promocionRequest', numeros: ['discountPct', 'packQuantity', 'packPrice', 'promoContent', 'promoPrice'] }),
  )
  @ApiOperation({ summary: 'El Gerente de categoría propone una promoción; nace pendiente (§6).' })
  @ApiConsumes('application/json', 'application/xml')
  @ApiBody({
    type: CrearPromocionDto,
    description: `JSON, o XML con raíz <promocionRequest xmlns="promotion/v1"> (máx. 1 MB, sin DOCTYPE). Ejemplo XML:\n\n\`\`\`xml\n${EJEMPLOS.peticionXml}\n\`\`\``,
    examples: { descuento: { value: EJEMPLOS.peticionJson } },
  })
  @ApiResponse({ status: 201, description: 'Promoción pendiente.', content: EJEMPLOS.contenido(EJEMPLOS.promocion, 'promocionResponse') })
  @ApiResponse({ status: 400, description: 'Datos inválidos, unidades incompatibles, ámbito, fechas o inexistente en catálogo.', content: EJEMPLOS.error(400) })
  @ApiResponse({ status: 403, description: 'Solo el Gerente de categoría propone.', content: EJEMPLOS.error(403) })
  @ApiResponse({ status: 409, description: 'Producto no activo o presentación dada de baja.', content: EJEMPLOS.error(409) })
  @ApiResponse({ status: 503, description: 'catalog-service no respondió en 3 s o PostgreSQL caído.', content: EJEMPLOS.error(503) })
  proponer(@Body() dto: CrearPromocionDto, @UsuarioActual() usuario: Solicitante, @Headers('authorization') token: string) {
    return this.promociones.proponer(dto, usuario, token);
  }

  @Get()
  @XmlRoot('promocionListResponse')
  @ApiOperation({ summary: 'Lista paginada; con status=pendiente es una cola (la más antigua primero) (§7).' })
  @ApiResponse({ status: 200, description: 'Página de promociones.', content: EJEMPLOS.contenido(EJEMPLOS.lista, 'promocionListResponse') })
  @ApiResponse({ status: 400, description: 'Filtro inválido (p. ej. status=vigente).', content: EJEMPLOS.error(400) })
  listar(@Query() q: ListarPromocionesDto) {
    return this.promociones.listar(q);
  }

  // `compare` es ruta LITERAL: va antes de `/:id` (§1).
  @Get('compare')
  @XmlRoot('comparacionPromocionesResponse')
  @ApiOperation({ summary: 'Compara de 2 a 10 promociones del mismo producto en una tienda, por precio unitario (§12).' })
  @ApiResponse({ status: 200, description: 'Ordenadas por precio unitario ascendente.', content: EJEMPLOS.contenido(EJEMPLOS.comparacion, 'comparacionPromocionesResponse') })
  @ApiResponse({ status: 400, description: 'ids, storeId, productos distintos, unidades incompatibles o fuera del ámbito.', content: EJEMPLOS.error(400) })
  @ApiResponse({ status: 404, description: 'Alguna promoción no existe.', content: EJEMPLOS.error(404) })
  comparar(@Query() q: CompararPromocionesDto, @Headers('authorization') token: string) {
    return this.promociones.comparar(q, token);
  }

  @Get(':id')
  @XmlRoot('promocionResponse')
  @ApiOperation({ summary: 'Una promoción (§8).' })
  @ApiResponse({ status: 200, description: 'La promoción.', content: EJEMPLOS.contenido(EJEMPLOS.promocion, 'promocionResponse') })
  @ApiResponse({ status: 404, description: 'No existe.', content: EJEMPLOS.error(404) })
  obtener(@Param('id', ID) id: string) {
    return this.promociones.obtener(id);
  }

  @Patch(':id/approve')
  @HttpCode(200)
  @XmlRoot('promocionResponse')
  @Roles(ROL.RESPONSABLE_PRECIOS)
  @MensajeProhibido('Solo el Responsable de precios aprueba promociones.')
  @ApiOperation({ summary: 'El Responsable de precios aprueba (sin cuerpo). No anexa nada a precios (D-39) (§9).' })
  @ApiResponse({ status: 200, description: 'Aprobada.', content: EJEMPLOS.contenido(EJEMPLOS.aprobada, 'promocionResponse') })
  @ApiResponse({ status: 403, description: 'Solo el Responsable de precios.', content: EJEMPLOS.error(403) })
  @ApiResponse({ status: 409, description: 'Ya resuelta o ya vencida.', content: EJEMPLOS.error(409) })
  aprobar(@Param('id', ID) id: string, @UsuarioActual() usuario: Solicitante, @Headers('authorization') token: string) {
    return this.promociones.aprobar(id, usuario, token);
  }

  @Patch(':id/reject')
  @HttpCode(200)
  @XmlRoot('promocionResponse')
  @Roles(ROL.RESPONSABLE_PRECIOS)
  @MensajeProhibido('Solo el Responsable de precios rechaza promociones.')
  @UseInterceptors(new CuerpoXmlInterceptor({ raiz: 'rechazoPromocionRequest' }))
  @ApiOperation({ summary: 'El Responsable de precios rechaza con motivo (10 a 500 caracteres) (§10).' })
  @ApiConsumes('application/json', 'application/xml')
  @ApiBody({
    type: RechazarPromocionDto,
    description: `JSON, o XML con raíz <rechazoPromocionRequest xmlns="promotion/v1">. Ejemplo XML:\n\n\`\`\`xml\n${EJEMPLOS.rechazoXml}\n\`\`\``,
  })
  @ApiResponse({ status: 200, description: 'Rechazada (sin validity).', content: EJEMPLOS.contenido(EJEMPLOS.rechazada, 'promocionResponse') })
  @ApiResponse({ status: 400, description: 'reason fuera de 10 a 500 caracteres.', content: EJEMPLOS.error(400) })
  @ApiResponse({ status: 409, description: 'Ya resuelta.', content: EJEMPLOS.error(409) })
  rechazar(
    @Param('id', ID) id: string,
    @Body() dto: RechazarPromocionDto,
    @UsuarioActual() usuario: Solicitante,
    @Headers('authorization') token: string,
  ) {
    return this.promociones.rechazar(id, dto.reason, usuario, token);
  }

  @Get(':id/unit-price')
  @XmlRoot('precioUnitarioResponse')
  @ApiOperation({ summary: 'Precio unitario regular vs. promocional en una tienda; no guarda nada (§11).' })
  @ApiResponse({ status: 200, description: 'Cálculo (disponible:false si un descuento no tiene precio regular).', content: EJEMPLOS.contenido(EJEMPLOS.precioUnitario, 'precioUnitarioResponse') })
  @ApiResponse({ status: 400, description: 'storeId faltante o fuera del ámbito.', content: EJEMPLOS.error(400) })
  @ApiResponse({ status: 404, description: 'No existe.', content: EJEMPLOS.error(404) })
  @ApiResponse({ status: 503, description: 'pricing o catalog sin responder.', content: EJEMPLOS.error(503) })
  precioUnitario(@Param('id', ID) id: string, @Query() q: PrecioUnitarioDto, @Headers('authorization') token: string) {
    return this.promociones.precioUnitario(id, q.storeId, token);
  }
}
