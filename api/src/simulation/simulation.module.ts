import { Module } from '@nestjs/common';

/**
 * M13 — Simulación de escenarios.
 *
 * Responsable: Fernando Olivares
 * Rama:        `feature/m13-simulacion`
 *
 * Alcance:
 * - Crear escenario, modificar precio o empaque, simular y comparar contra
 *   el escenario base. Cada corrida se guarda con sus parámetros para que
 *   la comparación sea reproducible. Consume M08, M11 y M12.
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
export class SimulationModule {}
