import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { ApiRespuesta } from '../common/swagger/ejemplos';
import { MonitoringStore } from '../monitoring/monitoring.store';
import { armarSalud, sinConfigurar, verificarRedis } from './checks';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly store: MonitoringStore) {}

  @Get()
  @XmlRoot('response', { namespace: '' })
  @ApiOperation({ summary: 'Salud del proceso, MongoDB y Redis.' })
  @ApiRespuesta(200, 'Estado del proceso y de sus dependencias.', {
    status: 'ok',
    service: 'monitoring-service',
    version: '1.0.0',
    checks: { postgres: 'no configurado', mongodb: 'ok', redis: 'ok' },
    latencyMs: { postgres: 0, mongodb: 3, redis: 2 },
    durationMs: 4,
    timestamp: '2026-11-23T19:00:00.000Z',
  }, 'response', '')
  check() {
    return armarSalud({
      postgres: sinConfigurar,
      mongodb: () => this.store.ping(),
      redis: verificarRedis,
    });
  }
}
