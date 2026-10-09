import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { ReportsModule } from './reports/reports.module';

/**
 * Módulo raíz de documents-service (M16): historial de reportes en MongoDB.
 * Lo transversal (filtros, interceptores, guard) viene de la plantilla.
 *
 * `serverSelectionTimeoutMS` corto: con Mongo caído el servicio sigue
 * arrancando (el health sale `degraded`) y las rutas de reportes responden 503.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({}),
    MongooseModule.forRoot(process.env.MONGO_URL ?? 'mongodb://localhost:27017/retaildb', {
      serverSelectionTimeoutMS: 2000,
      bufferCommands: false,
    }),
    ReportsModule,
  ],
  controllers: [HealthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AppModule {}
