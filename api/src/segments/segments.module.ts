import { Module } from '@nestjs/common';

/**
 * M05 — Segmentos de ingreso.
 *
 * Responsable: Pamela Rodríguez
 * Rama:        `feature/m05-segmentos`
 *
 * Alcance:
 * - Clasifica ZONAS en segmentos de ingreso, nunca personas: el ingreso se
 *   asigna por zona agregada y jamás se infiere de una compra individual
 *   (RN-02). Consume M03 Zonas; lo consumen M09, M11 y M12.
 *
 * Este módulo está declarado y registrado en AppModule a propósito
 * aunque todavía esté vacío: así quien lo desarrolle no tiene que tocar
 * `app.module.ts` y las cuatro ramas no chocan en ese archivo.
 *
 * Al implementarlo: agrega aquí `imports` (TypeOrmModule.forFeature con
 * tus entidades), `controllers`, `providers` y lo que otros módulos
 * necesiten en `exports`. Las entidades compartidas viven en
 * `src/entities/`; los guards y los nombres de rol, en `src/common/`.
 */
@Module({})
export class SegmentsModule {}
