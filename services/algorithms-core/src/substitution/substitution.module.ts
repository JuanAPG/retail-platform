import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionGuard } from '../common/auth/session.guard';
import { FuenteDatosModule } from '../fuente-datos/fuente-datos.module';
import { SubstitutionController } from './substitution.controller';
import { SubstitutionService } from './substitution.service';

/**
 * M11 — Patrones de sustitución. Sin entidades propias: se calcula al
 * vuelo con lo que lee FuenteDatos y no guarda nada. JwtModule y
 * SessionGuard van aquí, como en asociación y elasticidad.
 */
@Module({
  imports: [FuenteDatosModule, JwtModule.register({})],
  controllers: [SubstitutionController],
  providers: [SubstitutionService, SessionGuard],
})
export class SubstitutionModule {}
