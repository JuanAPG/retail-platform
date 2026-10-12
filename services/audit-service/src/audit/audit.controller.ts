import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ROL } from '../common/roles';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { ApiErrores, ApiRespuesta } from '../common/swagger/ejemplos';
import * as muestras from '../common/swagger/muestras';
import { AuditService } from './audit.service';
import { AuditFilterDto } from './dto/audit-filter.dto';
import { RegistrarEventoDto } from './dto/registrar-evento.dto';

/**
 * Bitácora append-only. El `POST` exige sesión válida (`SessionGuard`)
 * sin restricción de rol: cualquier perfil autenticado, incluido el
 * Proveedor, puede reportar eventos de sus propias acciones (p. ej.
 * proponer un precio). `usuarioId`/`rolId` SIEMPRE salen del token
 * verificado, nunca del cuerpo: así no hay forma de registrar un evento
 * sin sesión ni de falsificar quién lo hizo. La lectura exige
 * Administrador o Auditor. El prefijo `/v1` lo pone el global prefix:
 * aquí `auditoria`.
 */
@ApiTags('v1 Auditoria')
@ApiBearerAuth()
@Controller('auditoria')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard)
  @XmlRoot('auditCreateResponse')
  @ApiOperation({ summary: 'Registra un evento reportado por otro microservicio, a nombre del usuario del token.' })
  @ApiRespuesta(201, 'Id numérico del evento guardado.', { id: '123' }, 'auditCreateResponse')
  @ApiErrores(400, 401, 500)
  async registrar(@Body() dto: RegistrarEventoDto, @CurrentUser() usuario: SesionUsuario) {
    const id = await this.auditService.registrar({
      ...dto,
      usuarioId: usuario.id,
      rolId: usuario.rolId,
    });
    return { id };
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(ROL.ADMINISTRADOR, ROL.AUDITOR)
  @XmlRoot('auditListResponse')
  @ApiOperation({ summary: 'Bitácora paginada, de la más reciente a la más antigua.' })
  @ApiRespuesta(200, 'Eventos con sus campos modificados en `cambios`.', muestras.pagina, 'auditListResponse')
  @ApiErrores(400, 401, 403)
  findAll(@Query() filters: AuditFilterDto) {
    return this.auditService.find(filters);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(ROL.ADMINISTRADOR, ROL.AUDITOR)
  @XmlRoot('auditEventResponse')
  @ApiOperation({ summary: 'Detalle de un evento, con sus campos modificados en `cambios`.' })
  @ApiRespuesta(200, 'Evento de bitácora.', muestras.evento, 'auditEventResponse')
  @ApiErrores(401, 403, 404)
  findOne(@Param('id') id: string) {
    return this.auditService.findOne(id);
  }
}
