import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { ApiRespuesta } from '../common/swagger/ejemplos';
import { armarSalud, Salud, sinConfigurar, verificarPostgres, verificarRedis } from './checks';

/**
 * Salud del servicio — NO CAMBIAR su forma ni su ruta (plantilla, T-02).
 * `GET /v1/health`, sin autenticación y SIEMPRE 200 si el proceso responde.
 * Esquema XML: `docs/contratos/health.xsd`.
 *
 * Este servicio usa Postgres (sus dos tablas) y Redis (sesión). No usa
 * MongoDB: sale como `no configurado`, que no degrada.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Salud del servicio y de sus dependencias, con lo que tardó cada una.' })
  @XmlRoot('response', { namespace: '' })
  @ApiRespuesta(200, 'Estado del proceso y de sus dependencias.', {
    status: 'ok',
    service: 'audit-service',
    version: '1.0.0',
    checks: { postgres: 'ok', mongodb: 'no configurado', redis: 'ok' },
    latencyMs: { postgres: 3, mongodb: 0, redis: 2 },
    durationMs: 4,
    timestamp: '2026-11-23T19:00:00.000Z',
  }, 'response', '')
  check(): Promise<Salud> {
    return armarSalud({
      postgres: () => verificarPostgres(this.dataSource),
      mongodb: sinConfigurar,
      redis: verificarRedis,
    });
  }
}
