package com.udem.retaildecision.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * RF-38 (guardado local sin conexión): cuando el usuario de campo llena una
 * visita/encuesta sin internet, en vez de perder esos datos o bloquear la
 * app, los guardamos aquí en SQLite (vía Room). `synced = false` hasta que
 * el SyncWorker (RF-39) logre mandarlos a core-process-service.
 *
 * Guardamos latitud/longitud (RF-37) y el payload completo como JSON en
 * `payloadJson` para no tener que crear una tabla distinta por cada tipo de
 * formulario que se agregue después — simplifica el schema a costa de que
 * la validación de esos campos se hace en la capa de dominio, no en SQL.
 */
@Entity(tableName = "pending_visits")
data class PendingVisitEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val storeId: String,
    val latitude: Double,
    val longitude: Double,
    val payloadJson: String,
    val createdAtEpochMillis: Long,
    val synced: Boolean = false,
)
