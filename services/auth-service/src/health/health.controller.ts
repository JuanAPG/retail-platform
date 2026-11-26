import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { serializarXml } from '../common/interceptors/xml.interceptor';
import { armarSalud, Salud, sinConfigurar, verificarPostgres, verificarRedis } from './checks';

/**
 * Salud del servicio — NO CAMBIAR su forma ni su ruta (plantilla, T-02).
 * `GET /v1/health`, sin autenticación y SIEMPRE 200 si el proceso responde.
 * Esquema XML: `docs/contratos/health.xsd`.
 *
 * Este servicio usa Postgres (usuarios y roles) y Redis (sesión). No usa
 * MongoDB: sale como `no configurado`, que no degrada.
 */
const ejemplo: Salud = {
  status: 'ok',
  service: 'auth-service',
  version: '1.0.0',
  checks: { postgres: 'ok', mongodb: 'no configurado', redis: 'ok' },
  latencyMs: { postgres: 3, mongodb: 0, redis: 2 },
  durationMs: 4,
  timestamp: '2026-11-23T19:00:00.000Z',
};

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Salud del servicio y de sus dependencias, con lo que tardó cada una.' })
  @XmlRoot('response', { namespace: '' })
  @ApiOkResponse({ content: {
    'application/json': { example: ejemplo },
    'application/xml': { example: serializarXml(ejemplo, { namespace: '' }) },
  } })
  check(): Promise<Salud> {
    return armarSalud({
      postgres: () => verificarPostgres(this.dataSource),
      mongodb: sinConfigurar,
      redis: verificarRedis,
    });
  }
}
