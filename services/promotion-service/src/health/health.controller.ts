import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { armarSalud, Salud, sinConfigurar, verificarPostgres, verificarRedis } from './checks';

const EJEMPLO_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <status>ok</status>',
  '  <service>promotion-service</service>',
  '  <version>1.0.0</version>',
  '  <checks>',
  '    <postgres>ok</postgres>',
  '    <mongodb>no configurado</mongodb>',
  '    <redis>ok</redis>',
  '  </checks>',
  '  <latencyMs>',
  '    <postgres>3</postgres>',
  '    <mongodb>0</mongodb>',
  '    <redis>1</redis>',
  '  </latencyMs>',
  '  <durationMs>5</durationMs>',
  '  <timestamp>2026-10-30T15:00:00.000Z</timestamp>',
  '</response>',
].join('\n');

/**
 * Salud del servicio (contrato §16, `health.xsd`). `GET /v1/health`, sin
 * autenticación y SIEMPRE 200 si el proceso responde. Usa PostgreSQL y
 * Redis; MongoDB sale "no configurado". Con Postgres caído: `degraded` y las
 * rutas de negocio responden 503.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
          service: 'promotion-service',
          version: '1.0.0',
          checks: { postgres: 'ok', mongodb: 'no configurado', redis: 'ok' },
          latencyMs: { postgres: 3, mongodb: 0, redis: 1 },
          durationMs: 5,
          timestamp: '2026-10-30T15:00:00.000Z',
        },
      },
      'application/xml': { example: EJEMPLO_XML },
    },
  })
  check(): Promise<Salud> {
    return armarSalud({
      postgres: () => verificarPostgres(this.dataSource),
      mongodb: sinConfigurar,
      redis: verificarRedis,
    });
  }
}
