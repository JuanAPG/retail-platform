import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * Salud del servicio — NO CAMBIAR su forma ni su ruta.
 * `GET /v1/health`, sin autenticación. `status` siempre es `ok` si el
 * proceso responde; dependencias caídas se reportan en `checks`.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Salud del servicio.' })
  @ApiOkResponse({
    description: 'El servicio responde.',
    schema: {
      example: {
        status: 'ok',
        service: 'core-process-service',
        version: '1.0.0',
        timestamp: '2026-10-03T12:00:00.000Z',
      },
    },
  })
  check() {
    return {
      status: 'ok',
      service: process.env.SERVICE_NAME ?? 'unknown-service',
      version: process.env.SERVICE_VERSION ?? '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}
