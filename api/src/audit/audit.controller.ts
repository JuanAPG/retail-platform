import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ROL } from '../common/roles';
import { AuditService } from './audit.service';
import { AuditFilterDto } from './dto/audit-filter.dto';

/**
 * M15 — Lectura de la bitácora. Solo Administrador y Auditor (mismo
 * criterio que `GET /usuarios`: el Auditor consulta la bitácora como
 * parte de su trabajo). Sin escritura: la bitácora es append-only y
 * solo se alimenta desde `AuditService.log()`.
 */
@ApiTags('M15 Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('auditoria')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(ROL.ADMINISTRADOR, ROL.AUDITOR)
  @ApiOperation({ summary: 'Bitácora paginada, de la más reciente a la más antigua.' })
  @ApiOkResponse({ description: 'Eventos con sus campos modificados en `cambios`.' })
  findAll(@Query() filters: AuditFilterDto) {
    return this.auditService.find(filters);
  }
}
