import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, PaginationDto } from '../common/dto/pagination.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta } from '../common/swagger/ejemplos';
import { MonitoringService } from './monitoring.service';
import { MonitoringStore } from './monitoring.store';
import { SERVICES } from './targets';

const example = {
  service: 'availability-service',
  port: 3114,
  version: '1.0.0',
  status: 'degradado',
  checkedAt: '2026-11-23T19:00:00Z',
  latencyMs: 46,
  probeErrorsConsecutive: 0,
  dependencies: [
    { name: 'postgres', status: 'error', latencyMs: 44 },
    { name: 'mongodb', status: 'no configurado', latencyMs: 0 },
    { name: 'redis', status: 'ok', latencyMs: 2 },
    { name: 'bucket', status: 'no configurado', latencyMs: 0 },
  ],
};

@ApiTags('monitoreo')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Roles(ROL.ADMINISTRADOR)
@Controller('monitoring/services')
export class MonitoringController {
  constructor(
    private readonly monitoring: MonitoringService,
    private readonly store: MonitoringStore,
  ) {}

  @Get()
  @XmlRoot('monitorServices')
  @ApiOperation({ summary: 'Último sondeo de los 20 servicios.' })
  @ApiRespuesta(200, 'Lista de estados.', { data: [example] }, 'monitorServices')
  @ApiErrores(401, 403, 503)
  latest() {
    return { data: this.monitoring.latest() };
  }

  @Get(':service/history')
  @XmlRoot('monitorHistory')
  @ApiOperation({ summary: 'Sondeos de las últimas 24 horas, más recientes primero.' })
  @ApiRespuesta(200, 'Historial paginado.', { data: [example], total: 1, page: 1, limit: 20 }, 'monitorHistory')
  @ApiErrores(400, 401, 403, 404, 503)
  history(@Param('service') name: string, @Query() pagination: PaginationDto) {
    const service = SERVICES.find((known) => known === name);
    if (!service) throw new NotFoundException('El servicio solicitado no existe.');
    const page = pagination.page ?? PAGINA_DEFAULT;
    const limit = Math.min(pagination.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);
    return this.store.history(service, page, limit);
  }
}
