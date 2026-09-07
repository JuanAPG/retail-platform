import { Module } from '@nestjs/common';

/**
 * M06 — Transacciones e importación CSV.
 *
 * Responsable: Juan Angel Galván
 * Rama:        `feature/m06-transacciones`
 *
 * Alcance:
 * - Carga masiva por CSV con validación previa: ninguna fila inválida debe
 *   llegar a la base. Una transacción tiene tienda, fecha, total y
 *   detalles[] (producto, presentación, cantidad, precio_unitario,
 *   subtotal). Es el primer eslabón de la cadena: sin esto, M07 en
 *   adelante no tienen datos. Depende de las presentaciones de M04.
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
export class TransactionsModule {}
