import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IncomeSegment } from '../entities/income-segment.entity';
import { SegmentsController } from './segments.controller';
import { SegmentsService } from './segments.service';

/**
 * M05 — Segmentos de ingreso. Responsable: Pamela Rodríguez.
 * Rama: `feature/m05-segmentos`
 *
 * CRUD de IncomeSegment (RN-01, RN-02). El vínculo zona -> segmento vive
 * en `zona_clasificaciones` / `corrida_clusters` (fuera de este módulo):
 * aquí solo se administra el catálogo de segmentos, tal como lo define
 * `Contrato_Metodos_Endpoints`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IncomeSegment])],
  controllers: [SegmentsController],
  providers: [SegmentsService],
  exports: [SegmentsService],
})
export class SegmentsModule {}
