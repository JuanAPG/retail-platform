import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRedis } from '../common/auth/redis.client';

/**
 * Salud del servicio — NO CAMBIAR su forma ni su ruta.
 * `GET /v1/health`, sin autenticación y SIEMPRE 200 si el proceso
 * responde: así lo pueden consultar el `healthcheck` de Docker y quien
 * revise la demo, incluso con una dependencia caída.
 *
 * `status` es `ok` cuando todas las dependencias responden y `degraded`
 * cuando alguna falla; el detalle va en `checks`. Un servicio que agregue
 * dependencias (Postgres, Mongo) añade su propio check aquí.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Salud del servicio y de sus dependencias.' })
  @ApiOkResponse({
    description: 'El servicio responde (200 incluso si una dependencia está caída).',
    schema: {
      example: {
        status: 'ok',
        service: 'auth-service',
        version: '1.0.0',
        checks: { redis: 'ok' },
        timestamp: '2026-10-03T12:00:00.000Z',
      },
    },
  })
  async check() {
    const checks = { redis: await verificarRedis() };
    return {
      status: Object.values(checks).every((c) => c === 'ok') ? 'ok' : 'degraded',
      service: process.env.SERVICE_NAME ?? 'unknown-service',
      version: process.env.SERVICE_VERSION ?? '1.0.0',
      checks,
      timestamp: new Date().toISOString(),
    };
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
