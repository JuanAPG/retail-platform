import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { IncomeSegment } from '../entities/income-segment.entity';
import { SegmentsController } from './segments.controller';
import { SegmentsService } from './segments.service';

/**
 * M05 — Segmentos de ingreso (RN-01, RN-02). Aquí solo se administra el
 * catálogo; el vínculo zona→segmento vive en `zona_clasificaciones`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IncomeSegment]), JwtModule.register({})],
  controllers: [SegmentsController],
  providers: [SegmentsService, SessionGuard],
  exports: [SegmentsService],
})
export class SegmentsModule {}
