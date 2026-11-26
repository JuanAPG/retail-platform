import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { CatalogClient } from './common/catalog/catalog-client.service';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';

/**
 * Módulo raíz de la plantilla. Cada microservicio parte de aquí y agrega
 * sus módulos de negocio; lo transversal (filtros, interceptores, guard)
 * ya viene resuelto y NO se modifica por servicio.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({})],
  controllers: [HealthController, IngestionController],
  providers: [SessionGuard, CatalogClient, IngestionService],
  exports: [SessionGuard],
})
export class AppModule {}
