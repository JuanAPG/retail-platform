import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { AccessibilityZoneEntity } from '../entities/accessibility-zone.entity';
import { AccessibilityWeightEntity } from '../entities/accessibility-weight.entity';
import { AccessibilityComponentEntity } from '../entities/accessibility-component.entity';
import { IncomeSegment } from '../entities/income-segment.entity';
import { AccessibilityService } from './accessibility.service';
import { AccessibilityController } from './accessibility.controller';

/**
 * M12 — Accesibilidad. Combina precio + ingreso del segmento +
 * disponibilidad + cobertura de productos básicos (pesos iguales, ver
 * `AccessibilityWeightEntity`). No es "precio bajo": es un índice
 * compuesto, documentado como indicador analítico, no medida absoluta
 * de bienestar.
 *
 * No importa ningún módulo de zonas: ese catálogo lo posee
 * catalog-service. El dato de disponibilidad que antes venía de
 * `ZonesService.compareZones` se lee aquí con SQL directo sobre la vista
 * compartida `v_zona_indicadores` (ver `AccessibilityService.disponibilidad`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccessibilityZoneEntity,
      AccessibilityWeightEntity,
      AccessibilityComponentEntity,
      IncomeSegment,
    ]),
    JwtModule.register({}),
  ],
  controllers: [AccessibilityController],
  providers: [AccessibilityService, SessionGuard],
})
export class AccessibilityModule {}