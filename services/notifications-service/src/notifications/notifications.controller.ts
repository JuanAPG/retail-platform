import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Ip, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ROL } from '../common/roles';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationFilterDto } from './dto/notification-filter.dto';

/**
 * Notificaciones internas. La identidad siempre sale del JWT
 * (`SessionGuard`): `?userId` solo lo usan Admin/Auditor para ver las de
 * otro. El prefijo `/v1` lo pone el global prefix: aquí `notifications`.
 */
@ApiTags('v1 Notifications')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Emite una notificación (con dedup de 5 minutos).' })
  crear(
    @Body() dto: CreateNotificationDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
  ) {
    return this.notificationsService.create(dto, {
      usuarioId: usuario.id,
      rolId: usuario.rolId,
      ip,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Notificaciones del solicitante (por id o por rol).' })
  @ApiOkResponse({ description: 'Página {data,total,page,limit}.' })
  listar(@Query() filtros: NotificationFilterDto, @CurrentUser() usuario: SesionUsuario) {
    const [userId, resto] = this.destinatario(usuario, filtros);
    return this.notificationsService.findAllForUser(userId, usuario.rol, resto);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'No leídas del solicitante (agregación).' })
  contar(@CurrentUser() usuario: SesionUsuario) {
    return this.notificationsService.countUnread(usuario.id, usuario.rol);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marca como leída para el usuario del token.' })
  leer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() usuario: SesionUsuario) {
    return this.notificationsService.markAsRead(id, usuario.id);
  }

  /**
   * `?userId` ajeno solo para Admin/Auditor; el resto siempre ve lo suyo.
   * El rol viaja en el token, sin consultar tablas.
   */
  private destinatario(
    usuario: SesionUsuario,
    filtros: NotificationFilterDto,
  ): [string, NotificationFilterDto] {
    const { userId, ...resto } = filtros;
    if (!userId || userId === usuario.id) return [usuario.id, resto];
    if (usuario.rol !== ROL.ADMINISTRADOR && usuario.rol !== ROL.AUDITOR) {
      throw new ForbiddenException('Solo un Administrador o Auditor puede ver notificaciones ajenas.');
    }
    return [userId, resto];
  }
}
