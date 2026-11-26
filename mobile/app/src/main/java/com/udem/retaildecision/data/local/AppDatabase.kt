package com.udem.retaildecision.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Base de datos SQLite local (vía Room). Es el "almacenamiento offline"
 * del requisito RF-38. Instancia única por proceso (patrón singleton con
 * doble candado) para que dos pantallas no abran dos conexiones distintas
 * a la misma base de datos al mismo tiempo.
 *
 * Versión 2: folio por captura y acuse de offline-sync-service (D-42). La migración conserva
 * lo que ya estaba guardado; sin migración, Room se niega a abrir la base (no la borra).
 */
@Database(entities = [PendingVisitEntity::class], version = 2, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {

    abstract fun pendingVisitDao(): PendingVisitDao

    companion object {
        @Volatile private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "retail_decision.db",
                )
                    .addMigrations(Migraciones.MIGRACION_1_2)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
