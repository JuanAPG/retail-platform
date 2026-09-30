import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';

/**
 * Módulo raíz de la plantilla. Cada microservicio parte de aquí y agrega
 * sus módulos de negocio; lo transversal (filtros, interceptores, guard)
 * ya viene resuelto y NO se modifica por servicio.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController],
})
export class AppModule {}
