import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { armarSalud, Salud, sinConfigurar, verificarRedis } from './checks';

/**
 * Salud del servicio — NO CAMBIAR su forma ni su ruta.
 * `GET /v1/health`, sin autenticación y SIEMPRE 200 si el proceso
 * responde: así lo pueden consultar el `healthcheck` de Docker,
 * monitoring-service (T-09) y quien revise la demo, incluso con una
 * dependencia caída. Esquema XML: `docs/contratos/health.xsd`.
 *
 * Siempre reporta `postgres`, `mongodb` y `redis`. Un servicio que use
 * Postgres o Mongo cambia `sinConfigurar` por su check, p. ej.:
 *
 *   constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
 *   ...
 *   postgres: () => verificarPostgres(this.dataSource),
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Salud del servicio y de sus dependencias, con lo que tardó cada una.' })
  @ApiOkResponse({
    description: 'El servicio responde (200 incluso si una dependencia está caída).',
    schema: {
      example: {
        status: 'ok',
        service: process.env.SERVICE_NAME ?? 'unknown-service',
        version: '1.0.0',
        checks: { postgres: 'no configurado', mongodb: 'no configurado', redis: 'ok' },
        latencyMs: { postgres: 0, mongodb: 0, redis: 2 },
        durationMs: 3,
        timestamp: '2026-10-22T12:00:00.000Z',
      },
    },
  })
  check(): Promise<Salud> {
    return armarSalud({
      postgres: sinConfigurar,
      mongodb: sinConfigurar,
      redis: verificarRedis,
    });
  }
}
