import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { serializarXml } from '../common/interceptors/xml.interceptor';
import { armarSalud, sinConfigurar, verificarMongo, verificarRedis } from './checks';
import { asegurarMongo } from '../common/mongo/asegurar-mongo';

const ejemplo = {
  status: 'ok',
  service: 'notifications-service',
  version: '1.0.0',
  checks: { postgres: 'no configurado', mongodb: 'ok', redis: 'ok' },
  latencyMs: { postgres: 0, mongodb: 5, redis: 2 },
  durationMs: 5,
  timestamp: '2026-11-23T19:00:00.000Z',
};

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly conexion: Connection) {}

  @Get()
  @XmlRoot('response', { namespace: '' })
  @ApiOperation({ summary: 'Salud del proceso, MongoDB y Redis.' })
  @ApiOkResponse({ content: {
    'application/json': { example: ejemplo },
    'application/xml': { example: serializarXml(ejemplo, { namespace: '' }) },
  } })
  check() {
    return armarSalud({
      postgres: sinConfigurar,
      mongodb: async () => (await asegurarMongo(this.conexion), verificarMongo(this.conexion)),
      redis: verificarRedis,
    });
  }
}
