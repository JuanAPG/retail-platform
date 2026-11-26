import { Controller, Get, Headers, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MongoClient } from 'mongodb';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { quiereXml } from '../common/interceptors/xml.interceptor';
import { MONGO_CLIENT, nombreBaseMongo } from '../sync/almacen/mongo.repositorio';
import { CONFIG_DESTINO } from '../sync/destinos/destino';
import { ConfigDestino, saludDestino } from '../sync/destinos/destino-http';
import { armarSalud, Salud, sinConfigurar, verificarRedis } from './checks';

/**
 * Salud del servicio — forma y ruta de la plantilla (`health.xsd`).
 * `GET /v1/health`, sin autenticación y SIEMPRE 200 si el proceso responde.
 * Este servicio usa MongoDB y Redis; PostgreSQL sale "no configurado".
 *
 * `destinos` (modo `http` o `simulado` y si availability-service y
 * pricing-service responden su health) sale SOLO en JSON: `health.xsd`
 * (compartido, T-02) no admite más elementos, así que la respuesta XML se
 * queda tal cual para seguir validando. Un destino caído NO degrada
 * `status`: el servicio sigue recibiendo lotes y deja esas capturas
 * reintentables (contrato §6 y §9).
 */
export interface SaludConDestinos extends Salud {
  destinos?: { modo: ConfigDestino['modo']; availability: string; pricing: string };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(MONGO_CLIENT) private readonly mongo: MongoClient,
    @Inject(CONFIG_DESTINO) private readonly destino: ConfigDestino,
  ) {}

  @Get()
  // health.xsd no tiene targetNamespace: la raíz <response> va sin xmlns.
  @XmlRoot('response', { namespace: '' })
  @ApiOperation({ summary: 'Salud del servicio y de sus dependencias, con lo que tardó cada una.' })
  @ApiOkResponse({
    description: 'El servicio responde (200 incluso si una dependencia está caída: status degraded).',
    content: {
      'application/json': {
        example: {
          status: 'ok',
          service: 'offline-sync-service',
          version: '1.0.0',
          checks: { postgres: 'no configurado', mongodb: 'ok', redis: 'ok' },
          latencyMs: { postgres: 0, mongodb: 4, redis: 1 },
          durationMs: 6,
          timestamp: '2026-10-30T15:00:00.000Z',
          destinos: { modo: 'http', availability: 'ok', pricing: 'error: no respondió en 2000 ms' },
        },
      },
      'application/xml': {
        example:
          '<?xml version="1.0" encoding="UTF-8"?>\n<response>\n  <status>degraded</status>\n  <service>offline-sync-service</service>\n  <version>1.0.0</version>\n  <checks>\n    <postgres>no configurado</postgres>\n    <mongodb>error: connection refused</mongodb>\n    <redis>ok</redis>\n  </checks>\n  <latencyMs>\n    <postgres>0</postgres>\n    <mongodb>2001</mongodb>\n    <redis>1</redis>\n  </latencyMs>\n  <durationMs>2003</durationMs>\n  <timestamp>2026-10-30T15:00:00.000Z</timestamp>\n</response>',
      },
    },
  })
  async check(@Headers('accept') accept?: string): Promise<SaludConDestinos> {
    const [salud, destinos] = await Promise.all([
      armarSalud({
        postgres: sinConfigurar,
        mongodb: () => this.verificarMongo(),
        redis: verificarRedis,
      }),
      quiereXml(accept) ? Promise.resolve(null) : this.verificarDestinos(),
    ]);
    return destinos ? { ...salud, destinos } : salud;
  }

  private async verificarDestinos(): Promise<NonNullable<SaludConDestinos['destinos']>> {
    const { modo, availabilityUrl, pricingUrl } = this.destino;
    if (modo === 'simulado') return { modo, availability: 'no configurado', pricing: 'no configurado' };
    const [availability, pricing] = await Promise.all([
      saludDestino(availabilityUrl as string),
      saludDestino(pricingUrl as string),
    ]);
    return { modo, availability, pricing };
  }

  private async verificarMongo(): Promise<string> {
    try {
      await this.mongo.db(nombreBaseMongo()).command({ ping: 1 });
      return 'ok';
    } catch (error) {
      return error instanceof Error ? `error: ${error.message}` : 'error';
    }
  }
}
