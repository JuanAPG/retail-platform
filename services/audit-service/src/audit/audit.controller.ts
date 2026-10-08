import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ROL } from '../common/roles';
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
  @ApiOperation({ summary: 'Registra un evento reportado por otro microservicio, a nombre del usuario del token.' })
  @ApiOkResponse({ description: 'Id numérico del evento guardado.' })
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
  @ApiOperation({ summary: 'Bitácora paginada, de la más reciente a la más antigua.' })
  @ApiOkResponse({ description: 'Eventos con sus campos modificados en `cambios`.' })
  findAll(@Query() filters: AuditFilterDto) {
    return this.auditService.find(filters);
  }
}
