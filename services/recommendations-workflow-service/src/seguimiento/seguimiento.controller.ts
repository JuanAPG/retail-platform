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
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { MensajeProhibido, Roles, RolesGuard, UsuarioActual } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { CuerpoXmlInterceptor } from '../common/xml/cuerpo-xml';
import { AsignarDto, EvaluarDto, ImplementarDto, ListarDto } from './dto';
import { EJEMPLOS } from './ejemplos';
import { ROLES_ASIGNABLES } from './reglas';
import { SeguimientoService, Solicitante } from './seguimiento.service';

/** `:id` es el UUID del seguimiento; otro valor → 400 (§1). */
const ID = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException(':id debe ser un UUID (el id del seguimiento)') });

/**
 * Seguimiento de recomendaciones aceptadas (D-41). Permisos de §2: el Gerente
 * de categoría asigna y evalúa; SOLO el usuario asignado mueve start e
 * implement; los 6 perfiles internos leen; Proveedor e Investigador → 403.
 * Los guards corren ANTES de interpretar un cuerpo XML (`CuerpoXmlInterceptor`).
 */
@ApiTags('workflow')
@ApiBearerAuth()
@ApiProduces('application/json', 'application/xml')
@UseGuards(SessionGuard, RolesGuard)
@Roles(...PERFILES_INTERNOS)
@MensajeProhibido('Tu rol no tiene acceso al seguimiento de recomendaciones.')
@Controller('workflow/assignments')
export class SeguimientoController {
  constructor(private readonly seguimiento: SeguimientoService) {}

  @Post()
  @XmlRoot('seguimientoResponse')
  @Roles(ROL.GERENTE_CATEGORIA)
  @MensajeProhibido('Solo el Gerente de categoría asigna responsables.')
  @UseInterceptors(new CuerpoXmlInterceptor({ raiz: 'asignacionRequest' }))
  @ApiOperation({ summary: 'El Gerente asigna responsable a una recomendación aceptada (§5). 201 nuevo; 200 si es un reintento con el mismo responsable.' })
  @ApiConsumes('application/json', 'application/xml')
  @ApiBody({
    type: AsignarDto,
    description: `JSON, o XML con raíz <asignacionRequest xmlns="workflow/v1">. Ejemplo XML:\n\n\`\`\`xml\n${EJEMPLOS.asignacionXml}\n\`\`\``,
    examples: { asignacion: { value: EJEMPLOS.asignacionJson } },
  })
  @ApiResponse({ status: 201, description: 'Seguimiento creado (asignada).', content: EJEMPLOS.contenido(EJEMPLOS.asignado, 'seguimientoResponse') })
  @ApiResponse({ status: 200, description: 'Reintento con el mismo responsable: el seguimiento existente, sin auditar ni avisar.', content: EJEMPLOS.contenido(EJEMPLOS.asignado, 'seguimientoResponse') })
  @ApiResponse({ status: 404, description: 'La recomendación no existe en decision-service.', content: EJEMPLOS.error(404) })
  @ApiResponse({ status: 409, description: 'Recomendación no aceptada, u otro responsable ya asignado.', content: EJEMPLOS.error(409) })
  @ApiResponse({ status: 503, description: 'decision-service no respondió en 3 s.', content: EJEMPLOS.error(503) })
  async asignar(
    @Body() dto: AsignarDto,
    @UsuarioActual() usuario: Solicitante,
    @Headers('authorization') token: string,
    @Res({ passthrough: true }) res: { status(codigo: number): unknown },
  ) {
    const { creado, cuerpo } = await this.seguimiento.asignar(dto, usuario, token);
    res.status(creado ? 201 : 200);
    return cuerpo;
  }

  @Get()
  @XmlRoot('seguimientoListResponse')
  @ApiOperation({ summary: 'Lista paginada, la más reciente (assignedAt) primero (§9).' })
  @ApiResponse({ status: 200, description: 'Página de seguimientos.', content: EJEMPLOS.contenido(EJEMPLOS.lista, 'seguimientoListResponse') })
  @ApiResponse({ status: 400, description: 'Filtro inválido (p. ej. status=aprobada).', content: EJEMPLOS.error(400) })
  listar(@Query() q: ListarDto, @UsuarioActual() usuario: Solicitante) {
    return this.seguimiento.listar(q, usuario);
  }

  @Get(':id')
  @XmlRoot('seguimientoResponse')
  @ApiOperation({ summary: 'Un seguimiento (§9).' })
  @ApiResponse({ status: 200, description: 'El seguimiento.', content: EJEMPLOS.contenido(EJEMPLOS.evaluado, 'seguimientoResponse') })
  @ApiResponse({ status: 404, description: 'No existe.', content: EJEMPLOS.error(404) })
  obtener(@Param('id', ID) id: string) {
    return this.seguimiento.obtener(id);
  }

  @Patch(':id/start')
  @HttpCode(200)
  @XmlRoot('seguimientoResponse')
  @Roles(...ROLES_ASIGNABLES)
  @MensajeProhibido('Solo el responsable asignado puede mover este seguimiento.')
  @ApiOperation({ summary: 'El asignado inicia: asignada → en_implementacion (§6). Sin cuerpo.' })
  @ApiResponse({ status: 200, description: 'En implementación.', content: EJEMPLOS.contenido({ ...EJEMPLOS.asignado, status: 'en_implementacion', startedAt: '2026-10-31T15:00:00.000Z' }, 'seguimientoResponse') })
  @ApiResponse({ status: 403, description: 'No es el responsable asignado.', content: EJEMPLOS.error(403) })
  @ApiResponse({ status: 409, description: 'Fuera de orden o repetida.', content: EJEMPLOS.error(409) })
  iniciar(@Param('id', ID) id: string, @UsuarioActual() usuario: Solicitante, @Headers('authorization') token: string) {
    return this.seguimiento.iniciar(id, usuario, token);
  }

  @Patch(':id/implement')
  @HttpCode(200)
  @XmlRoot('seguimientoResponse')
  @Roles(...ROLES_ASIGNABLES)
  @MensajeProhibido('Solo el responsable asignado puede mover este seguimiento.')
  @UseInterceptors(new CuerpoXmlInterceptor({ raiz: 'implementacionRequest' }))
  @ApiOperation({ summary: 'El asignado marca implementada: en_implementacion → implementada (§7).' })
  @ApiConsumes('application/json', 'application/xml')
  @ApiBody({
    type: ImplementarDto,
    description: `JSON, o XML con raíz <implementacionRequest xmlns="workflow/v1">. Ejemplo XML:\n\n\`\`\`xml\n${EJEMPLOS.implementacionXml}\n\`\`\``,
  })
  @ApiResponse({ status: 200, description: 'Implementada.', content: EJEMPLOS.contenido({ ...EJEMPLOS.evaluado, status: 'implementada', evaluatedBy: null, evaluatedAt: null, evaluation: null }, 'seguimientoResponse') })
  @ApiResponse({ status: 400, description: 'note corta o implementedOn fuera de rango.', content: EJEMPLOS.error(400) })
  @ApiResponse({ status: 403, description: 'No es el responsable asignado.', content: EJEMPLOS.error(403) })
  @ApiResponse({ status: 409, description: 'Fuera de orden o repetida.', content: EJEMPLOS.error(409) })
  implementar(
    @Param('id', ID) id: string,
    @Body() dto: ImplementarDto,
    @UsuarioActual() usuario: Solicitante,
    @Headers('authorization') token: string,
  ) {
    return this.seguimiento.implementar(id, dto, usuario, token);
  }

  @Patch(':id/evaluate')
  @HttpCode(200)
  @XmlRoot('seguimientoResponse')
  @Roles(ROL.GERENTE_CATEGORIA)
  @MensajeProhibido('Solo el Gerente de categoría evalúa los seguimientos.')
  @UseInterceptors(
    new CuerpoXmlInterceptor({ raiz: 'evaluacionRequest', numeros: ['before.value', 'after.value'], objetos: ['scope', 'before', 'after'] }),
  )
  @ApiOperation({ summary: 'El Gerente evalúa con la métrica de impacto: implementada → evaluada; el servidor calcula variationPct (§8).' })
  @ApiConsumes('application/json', 'application/xml')
  @ApiBody({
    type: EvaluarDto,
    description: `JSON, o XML con raíz <evaluacionRequest xmlns="workflow/v1">. Ejemplo XML:\n\n\`\`\`xml\n${EJEMPLOS.evaluacionXml}\n\`\`\``,
  })
  @ApiResponse({ status: 200, description: 'Evaluada.', content: EJEMPLOS.contenido(EJEMPLOS.evaluado, 'seguimientoResponse') })
  @ApiResponse({ status: 400, description: 'Unidad, alcance, periodos o before.value = 0.', content: EJEMPLOS.error(400) })
  @ApiResponse({ status: 403, description: 'Solo el Gerente de categoría.', content: EJEMPLOS.error(403) })
  @ApiResponse({ status: 409, description: 'Fuera de orden o repetida.', content: EJEMPLOS.error(409) })
  evaluar(
    @Param('id', ID) id: string,
    @Body() dto: EvaluarDto,
    @UsuarioActual() usuario: Solicitante,
    @Headers('authorization') token: string,
  ) {
    return this.seguimiento.evaluar(id, dto, usuario, token);
  }

  @Get(':id/history')
  @XmlRoot('historialSeguimientoResponse')
  @ApiOperation({ summary: 'Eventos del seguimiento en orden cronológico, con el estado de auditoría y aviso (§9). No se pagina.' })
  @ApiResponse({ status: 200, description: 'Historial.', content: EJEMPLOS.contenido(EJEMPLOS.historial, 'historialSeguimientoResponse') })
  @ApiResponse({ status: 404, description: 'No existe.', content: EJEMPLOS.error(404) })
  historial(@Param('id', ID) id: string) {
    return this.seguimiento.historial(id);
  }
}
