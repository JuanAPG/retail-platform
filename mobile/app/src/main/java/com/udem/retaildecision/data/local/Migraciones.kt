package com.udem.retaildecision.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Migraciones de la base local. Las sentencias van en listas de texto, sin tipos de Android,
 * para que la prueba unitaria `MigracionTest` las corra contra SQLite en la JVM.
 */
object Migraciones {

    /** UUID v4 armado en SQL (SQLite no trae una función de UUID). Se evalúa por fila. */
    private const val UUID_SQL =
        "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || " +
            "substr(lower(hex(randomblob(2))), 2) || '-' || " +
            "substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || " +
            "lower(hex(randomblob(6)))"

    /** Gson escribe `"error":` en el payload solo cuando el servidor anterior rechazó la captura. */
    private const val TENIA_ERROR = "instr(payloadJson, '\"error\":') > 0"

    /**
     * Versión 1 → 2 (offline-sync-service, D-42). No borra nada: agrega columnas y las llena.
     * - Cada captura recibe su folio (`captureId`) aquí, una sola vez; desde ese momento ya no cambia.
     * - `capturedAt` sale de `createdAtEpochMillis` en UTC (`Z`), que es zona horaria válida.
     * - Todas las filas anteriores son precios observados (la versión 1 solo capturaba precios).
     * - Las pendientes siguen pendientes y ahora se envían por offline-sync-service. Las que la
     *   versión 1 ya mandó a pricing-service quedan aceptadas, y las que pricing rechazó quedan
     *   rechazadas (su motivo sigue en `payloadJson.error`).
     * - Las filas anteriores no tienen dueño (`userId` nulo): las envía la siguiente sesión que sincronice.
     */
    val SQL_1_2: List<String> = listOf(
        "ALTER TABLE pending_visits ADD COLUMN captureId TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE pending_visits ADD COLUMN tipo TEXT NOT NULL DEFAULT 'precio_observado'",
        "ALTER TABLE pending_visits ADD COLUMN capturedAt TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE pending_visits ADD COLUMN userId TEXT",
        "ALTER TABLE pending_visits ADD COLUMN estadoSync TEXT NOT NULL DEFAULT 'pendiente'",
        "ALTER TABLE pending_visits ADD COLUMN reintentable INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE pending_visits ADD COLUMN motivoCodigo TEXT",
        "ALTER TABLE pending_visits ADD COLUMN motivoMensaje TEXT",
        "ALTER TABLE pending_visits ADD COLUMN destinoServicio TEXT",
        "ALTER TABLE pending_visits ADD COLUMN destinoId TEXT",
        "ALTER TABLE pending_visits ADD COLUMN estadoOriginal TEXT",
        "ALTER TABLE pending_visits ADD COLUMN serverCapturedAt TEXT",
        "UPDATE pending_visits SET " +
            "captureId = $UUID_SQL, " +
            "capturedAt = strftime('%Y-%m-%dT%H:%M:%SZ', createdAtEpochMillis / 1000, 'unixepoch')",
        "UPDATE pending_visits SET " +
            "estadoSync = CASE WHEN synced = 0 THEN 'pendiente' WHEN $TENIA_ERROR THEN 'rechazada' ELSE 'aceptada' END, " +
            "destinoServicio = CASE WHEN synced = 1 AND NOT ($TENIA_ERROR) THEN 'pricing-service' END",
        // Mismo nombre y forma que el índice que Room genera para @Index(unique = true) en `captureId`.
        "CREATE UNIQUE INDEX IF NOT EXISTS `index_pending_visits_captureId` ON `pending_visits` (`captureId`)",
    )

    val MIGRACION_1_2: Migration = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            SQL_1_2.forEach(db::execSQL)
        }
    }
}
