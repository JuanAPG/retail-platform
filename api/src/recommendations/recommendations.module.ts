import { Module } from '@nestjs/common';

/**
 * M14 — Recomendaciones.
 *
 * Responsable: Fernando Olivares
 * Rama:        `feature/m14-recomendaciones`
 *
 * Alcance:
 * - Motor de REGLAS simple, no IA todavía. Cada recomendación debe explicar
 *   qué recomienda, por qué, con qué datos y qué impacto estima. Es el
 *   último eslabón: consume prácticamente todo lo anterior.
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
export class RecommendationsModule {}
