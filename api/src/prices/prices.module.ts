import { Module } from '@nestjs/common';

/**
 * M08 — Precios.
 *
 * Responsable: Pamela Rodríguez
 * Rama:        `feature/m08-precios`
 *
 * Alcance:
 * - Precios vigentes e histórico por presentación, tienda y periodo. El
 *   histórico es lo que hace posible calcular elasticidad en M11, así que
 *   no se sobrescribe: se versiona. Incluye el flujo de precios
 *   propuestos por proveedor y su aprobación por Responsable de precios.
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
export class PricesModule {}
