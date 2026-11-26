import { Controller, Get, Inject } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import { getRedis } from '../common/auth/redis.client';
import { ALMACEN_OBJETOS, AlmacenObjetos } from '../reports/archivos/almacen/almacen';
import { asegurarMongo } from '../common/mongo/asegurar-mongo';

/** El bucket no se consulta en cada health: una vez cada 30 s basta y no castiga al monitoreo (T-09). */
const VIGENCIA_ALMACEN_MS = 30_000;

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
  private almacenCache: { valor: string; en: number } | null = null;

  constructor(
    @InjectConnection() private readonly mongo: Connection,
    @Inject(ALMACEN_OBJETOS) private readonly almacen: AlmacenObjetos,
  ) {}

  private async verificarAlmacen(): Promise<string> {
    if (this.almacenCache && Date.now() - this.almacenCache.en < VIGENCIA_ALMACEN_MS) return this.almacenCache.valor;
    const valor = await this.almacen.verificar();
    this.almacenCache = { valor, en: Date.now() };
    return valor;
  }

  @Get()
  @ApiOperation({ summary: 'Salud del servicio y de sus dependencias.' })
  @ApiOkResponse({
    description: 'El servicio responde (200 incluso si una dependencia está caída).',
    schema: {
      example: {
        status: 'ok',
        service: process.env.SERVICE_NAME ?? 'unknown-service',
        version: '1.0.0',
        checks: { redis: 'ok', mongodb: 'ok', almacen: 'ok' },
        almacen: { tipo: 'gcs', bucket: 'retail-staging-reportes' },
        timestamp: '2026-10-03T12:00:00.000Z',
      },
    },
  })
  async check() {
    const checks = {
      redis: await verificarRedis(),
      mongodb: (await asegurarMongo(this.mongo)) ? 'ok' : 'error: sin conexión a MongoDB',
      almacen: await this.verificarAlmacen(),
    };
    return {
      status: Object.values(checks).every((c) => c === 'ok') ? 'ok' : 'degraded',
      service: process.env.SERVICE_NAME ?? 'unknown-service',
      version: process.env.SERVICE_VERSION ?? '1.0.0',
      checks,
      // Qué almacén y bucket usa (no es secreto; sin credenciales ni rutas físicas).
      almacen: { tipo: this.almacen.tipo, bucket: this.almacen.bucket },
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
