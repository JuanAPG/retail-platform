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
  controllers: [HealthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AppModule {}
