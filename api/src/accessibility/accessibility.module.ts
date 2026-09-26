import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessibilityZoneEntity } from '../entities/accessibility-zone.entity';
import { AccessibilityWeightEntity } from '../entities/accessibility-weight.entity';
import { AccessibilityComponentEntity } from '../entities/accessibility-component.entity';
import { IncomeSegment } from '../entities/income-segment.entity';
import { ZonesModule } from '../zones/zones.module';
import { AccessibilityService } from './accessibility.service';
import { AccessibilityController } from './accessibility.controller';

/**
 * M12 — Accesibilidad. Combina precio + ingreso del segmento +
 * disponibilidad + cobertura de productos básicos (pesos iguales, ver
 * `AccessibilityWeightEntity`). No es "precio bajo": es un índice
 * compuesto, documentado como indicador analítico, no medida absoluta
 * de bienestar.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccessibilityZoneEntity,
      AccessibilityWeightEntity,
      AccessibilityComponentEntity,
      IncomeSegment,
    ]),
    ZonesModule,
  ],
  controllers: [AccessibilityController],
  providers: [AccessibilityService],
})
export class AccessibilityModule {}