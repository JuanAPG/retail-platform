import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { getRedis } from '../common/auth/redis.client';

/**
 * Salud del servicio — NO CAMBIAR su forma ni su ruta.
 * `GET /v1/health`, sin autenticación y SIEMPRE 200 si el proceso
 * responde: así lo pueden consultar el `healthcheck` de Docker y quien
 * revise la demo, incluso con una dependencia caída.
 *
 * `status` es `ok` cuando Postgres y Redis responden y `degraded` cuando
 * alguno falla; el detalle va en `checks`. Postgres se verifica porque sin
 * él ningún endpoint de M06/M07/M09 puede operar, y Redis porque el
 * `SessionGuard` lo consulta en cada petición protegida.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Salud del servicio y de sus dependencias.' })
  @ApiOkResponse({
    description: 'El servicio responde (200 incluso si una dependencia está caída).',
    schema: {
      example: {
        status: 'ok',
        service: 'nombre-del-servicio',
        version: '1.0.0',
        checks: { postgres: 'ok', redis: 'ok' },
        timestamp: '2026-10-03T12:00:00.000Z',
      },
    },
  })
  async check() {
    const [postgres, redis] = await Promise.all([this.verificarPostgres(), verificarRedis()]);
    const checks = { postgres, redis };
    return {
      status: Object.values(checks).every((c) => c === 'ok') ? 'ok' : 'degraded',
      service: process.env.SERVICE_NAME ?? 'unknown-service',
      version: process.env.SERVICE_VERSION ?? '1.0.0',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async verificarPostgres(): Promise<string> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'ok';
    } catch (error) {
      return error instanceof Error ? `error: ${error.message}` : 'error';
    }
  }
}

/** `ok` o el motivo del fallo. Nunca lanza: el health no debe caerse. */
export async function verificarRedis(): Promise<string> {
  try {
    await getRedis().ping();
    return 'ok';
  } catch (error) {
    return error instanceof Error ? `error: ${error.message}` : 'error';
  }
}
