package com.udem.retaildecision.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update

@Dao
interface PendingVisitDao {

    @Insert
    suspend fun insert(visit: PendingVisitEntity): Long

    @Query("SELECT * FROM pending_visits WHERE synced = 0 ORDER BY createdAtEpochMillis ASC")
    suspend fun getUnsynced(): List<PendingVisitEntity>

    @Update
    suspend fun update(visit: PendingVisitEntity)

    @Query("SELECT COUNT(*) FROM pending_visits WHERE synced = 0")
    suspend fun countUnsynced(): Int
}
