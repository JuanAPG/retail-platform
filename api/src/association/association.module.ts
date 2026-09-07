import { Module } from '@nestjs/common';

/**
 * M10 — Reglas de asociación (Apriori).
 *
 * Responsable: Leonardo Rangel
 * Rama:        `feature/m10-asociacion`
 *
 * Alcance:
 * - Soporte y confianza configurables (RF-15). Debe guardar la CORRIDA
 *   COMPLETA — parámetros, fecha, usuario, dataset y resultados — no solo
 *   el resultado final, para poder reproducirla después. Consume M07.
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
export class AssociationModule {}
