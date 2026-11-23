import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { AuditReporter } from './common/audit/audit-reporter.service';
import { ServiciosExternos } from './common/http/servicios-externos.service';
import { SegmentsController } from './segments/segments.controller';
import { SegmentsService } from './segments/segments.service';
import { ClassificationsController } from './classifications/classifications.controller';
import { ClassificationsService } from './classifications/classifications.service';
import { PublicationController } from './publication/publication.controller';
import { PublicationService } from './publication/publication.service';

/**
 * income-segmentation-service (D-35, D-36): segmentos de ingreso versionados,
 * clasificación de zonas con la versión con la que se hizo y la regla de
 * publicación de agregados. Lo transversal (filtros, interceptores,
 * SessionGuard, correlación, health) viene de la plantilla y no se modifica.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    JwtModule.register({}),
  ],
  controllers: [HealthController, SegmentsController, ClassificationsController, PublicationController],
  providers: [
    SessionGuard,
    AuditReporter,
    ServiciosExternos,
    SegmentsService,
    ClassificationsService,
    PublicationService,
  ],
})
export class AppModule {}
