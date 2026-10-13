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
 */
@Database(entities = [PendingVisitEntity::class], version = 1, exportSchema = false)
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
                ).build().also { INSTANCE = it }
            }
        }
    }
}
