import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZonaEntity } from '../entities/zona.entity';
import { MunicipioEntity } from '../entities/municipio.entity';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';

/**
 * M03 — Zonas. Responsable: Pamela Rodríguez.
 * Rama: `feature/m03-zonas`
 *
 * Pendiente: CRUD de zonas, asignación de municipio y vínculo con el
 * segmento de ingreso que calcula M05 (RN-01, RN-02).
 */
@Module({
  imports: [TypeOrmModule.forFeature([ZonaEntity, MunicipioEntity])],
  controllers: [ZonesController],
  providers: [ZonesService],
  exports: [ZonesService],
})
export class ZonesModule {}
