import { Module } from '@nestjs/common';

/**
 * M07 — Canastas de consumo.
 *
 * Responsable: Fernando Olivares
 * Rama:        `feature/m07-canastas`
 *
 * Alcance:
 * - Una canasta = una transacción. Construye las canastas a partir de lo
 *   que carga M06 y las clasifica por zona y segmento (M03, M05).
 *   Alimenta a M09, M10 y M12.
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
export class BasketsModule {}
