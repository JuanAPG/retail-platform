import { Module } from '@nestjs/common';

/**
 * M15 — Auditoría.
 *
 * Responsable: Juan Angel Galván
 * Rama:        `feature/m15-auditoria`
 *
 * Alcance:
 * - Bitácora inmutable de operaciones: usuario, acción, entidad y estado
 *   previo/posterior. Registro append-only, sin edición ni borrado. La
 *   escritura NO debe poder tumbar la operación de negocio que la origina.
 *   Candidato a MongoDB en el Parcial 2 (cada evento tiene forma distinta).
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
export class AuditModule {}
