package com.udem.retaildecision.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingVisitDao {

    @Insert
    suspend fun insert(visit: PendingVisitEntity): Long

    @Query("SELECT * FROM pending_visits WHERE synced = 0 ORDER BY createdAtEpochMillis ASC")
    suspend fun getUnsynced(): List<PendingVisitEntity>

    /**
     * Lo que falta enviar de ESTA persona, en el orden en que se capturó. Las filas sin dueño
     * (anteriores a la versión 2 de la base) las adopta quien sincronice primero.
     */
    @Query(
        "SELECT * FROM pending_visits WHERE synced = 0 AND (userId = :userId OR userId IS NULL) " +
            "ORDER BY createdAtEpochMillis ASC, id ASC",
    )
    suspend fun pendientesDe(userId: String): List<PendingVisitEntity>

    @Query("SELECT * FROM pending_visits WHERE captureId IN (:captureIds)")
    suspend fun porCaptureIds(captureIds: List<String>): List<PendingVisitEntity>

    /** Las ya enviadas al servidor (para preguntarle si el Responsable de precios ya decidió). */
    @Query("SELECT * FROM pending_visits WHERE synced = 1")
    suspend fun getSynced(): List<PendingVisitEntity>

    @Update
    suspend fun update(visit: PendingVisitEntity)

    /** Todas las capturas guardadas en el teléfono, las más recientes primero. Se actualiza sola. */
    @Query("SELECT * FROM pending_visits ORDER BY createdAtEpochMillis DESC")
    fun observeAll(): Flow<List<PendingVisitEntity>>

    @Query("SELECT COUNT(*) FROM pending_visits WHERE synced = 0")
    suspend fun countUnsynced(): Int
}
