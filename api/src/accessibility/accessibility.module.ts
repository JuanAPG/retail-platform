import { Module } from '@nestjs/common';

/**
 * M12 — Accesibilidad.
 *
 * Responsable: Fernando Olivares
 * Rama:        `feature/m12-accesibilidad`
 *
 * Alcance:
 * - NO es 'precio bajo'. Combina precio + ingreso del segmento +
 *   disponibilidad + productos básicos. Debe documentarse en la respuesta
 *   que es un indicador analítico, no una medida absoluta de bienestar.
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
export class AccessibilityModule {}
