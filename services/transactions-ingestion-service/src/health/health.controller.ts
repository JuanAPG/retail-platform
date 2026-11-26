import { Controller, Get } from '@nestjs/common';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { IngestionService } from '../ingestion.service';
import { armarSalud, sinConfigurar, verificarPostgres, verificarRedis } from './checks';

@Controller('health')
export class HealthController {
  constructor(private readonly ingestion: IngestionService) {}

  @Get()
  @XmlRoot('response', { namespace: '' })
  check() {
    const checks = {
      postgres: () => verificarPostgres({ query: () => this.ingestion.ping() }),
      mongodb: sinConfigurar, redis: verificarRedis,
    };
    return armarSalud(process.env.GCS_INGESTION_BUCKET ? { ...checks, bucket: () => this.ingestion.bucketHealth() } : checks);
  }
}
