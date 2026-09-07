import { Module } from '@nestjs/common';

/**
 * M09 — Analítica descriptiva.
 *
 * Responsable: Leonardo Rangel
 * Rama:        `feature/m09-analitica`
 *
 * Alcance:
 * - Indicadores descriptivos por zona, segmento y categoría a partir de las
 *   canastas de M07. Es la base de comparación del resto del análisis.
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
export class AnalyticsModule {}
