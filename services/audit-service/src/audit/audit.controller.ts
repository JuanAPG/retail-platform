import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ROL } from '../common/roles';
import { AuditService } from './audit.service';
import { AuditFilterDto } from './dto/audit-filter.dto';
import { RegistrarEventoDto } from './dto/registrar-evento.dto';

/**
 * Bitácora append-only. El `POST` va SIN guard a propósito: vive en la
 * red privada de compose y la auditoría nunca debe bloquear al
 * reportero (que además la llama fire-and-forget con timeout). La
 * lectura exige Administrador o Auditor. El prefijo `/v1` lo pone el
 * global prefix: aquí `auditoria`.
 */
@ApiTags('v1 Auditoria')
@Controller('auditoria')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registra un evento reportado por otro microservicio.' })
  @ApiOkResponse({ description: 'Id numérico del evento guardado.' })
  async registrar(@Body() dto: RegistrarEventoDto) {
    const id = await this.auditService.registrar(dto);
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
