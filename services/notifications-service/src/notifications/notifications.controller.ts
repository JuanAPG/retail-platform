import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpStatus, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
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
  @XmlRoot('notificationResponse')
  @ApiOperation({
    summary: 'Emite una notificación (con dedup de 5 minutos).',
    description:
      'El ROL del token decide si puede originar el evento (tabla de `notification.types.ts`), ' +
      'y el DESTINATARIO lo fija la regla del evento, no el emisor. `sourceService` es ' +
      'obligatorio y de lista cerrada.',
  })
  @ApiCreatedResponse({ description: 'Notificación creada (201).' })
  @ApiOkResponse({ description: 'Duplicada en ventana: devuelve la existente (200).' })
  @ApiForbiddenResponse({ description: 'El rol del token no puede originar este evento.' })
  async crear(
    @Body() dto: CreateNotificationDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
    @Headers('authorization') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, creada } = await this.notificationsService.create(dto, {
      usuarioId: usuario.id,
      // El rol del token ES el rol de origen: los servicios emisores
      // reenvían el Authorization del usuario que originó la acción
      // (decisión de equipo). Con eso se valida quién puede disparar qué.
      rol: usuario.rol,
      rolId: usuario.rolId,
      ip,
      token,
    });
    res.status(creada ? HttpStatus.CREATED : HttpStatus.OK);
    return data;
  }

  @Get()
  @XmlRoot('notificationListResponse')
  @ApiOperation({ summary: 'Notificaciones del solicitante (por id o por rol).' })
  @ApiOkResponse({ description: 'Página {data,total,page,limit}.' })
  listar(@Query() filtros: NotificationFilterDto, @CurrentUser() usuario: SesionUsuario) {
    const [userId, resto] = this.destinatario(usuario, filtros);
    return this.notificationsService.findAllForUser(userId, usuario.rol, resto);
  }

  @Get('unread-count')
  @XmlRoot('unreadCountResponse')
  @ApiOperation({ summary: 'No leídas del solicitante (agregación).' })
  contar(@CurrentUser() usuario: SesionUsuario) {
    return this.notificationsService.countUnread(usuario.id, usuario.rol);
  }

  @Get(':id')
  @XmlRoot('notificationDetailResponse')
  @ApiOperation({
    summary: 'Una notificación dirigida al solicitante.',
    description:
      'Solo si va dirigida a él (`recipientUserId` = su id, o `recipientRole` = su rol). ' +
      'Si no, 404: un 403 confirmaría que esa notificación existe.',
  })
  @ApiOkResponse({ description: 'La notificación.' })
  @ApiNotFoundResponse({ description: 'No existe, o no va dirigida al solicitante.' })
  ver(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() usuario: SesionUsuario) {
    return this.notificationsService.findOneForUser(id, { id: usuario.id, rol: usuario.rol });
  }

  @Patch(':id/read')
  @XmlRoot('notificationResponse')
  @ApiOperation({
    summary: 'Marca como leída para el usuario del token.',
    description:
      'Solo si va dirigida a él. Antes no se comprobaba el destinatario: un Proveedor ' +
      'marcaba como leída la notificación de un Gerente y la respuesta le devolvía el ' +
      'contenido.',
  })
  @ApiOkResponse({ description: 'La notificación, ya marcada.' })
  @ApiNotFoundResponse({ description: 'No existe, o no va dirigida al solicitante.' })
  leer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() usuario: SesionUsuario) {
    return this.notificationsService.markAsRead(id, { id: usuario.id, rol: usuario.rol });
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
