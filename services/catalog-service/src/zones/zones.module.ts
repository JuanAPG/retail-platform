import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { MunicipioEntity } from '../entities/municipio.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';

/**
 * M03 — Zonas y municipios. Solo la identidad de la zona vive aquí; su
 * segmento de ingreso (`zona_clasificaciones`) y sus indicadores los
 * calcula Analítica y este módulo únicamente los lee en `compare`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ZonaEntity, MunicipioEntity]), JwtModule.register({})],
  controllers: [ZonesController],
  providers: [ZonesService, SessionGuard],
  exports: [ZonesService],
})
export class ZonesModule {}
