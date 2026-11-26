package com.udem.retaildecision.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Una captura de campo guardada en el teléfono (RF-38, sin conexión). La envía el SyncWorker a
 * offline-sync-service en un lote (D-42) y aquí se guarda el acuse que regresa por captura.
 *
 * El nombre de la tabla (`pending_visits`) se conserva para no perder lo que ya había en los
 * teléfonos; la migración 1 → 2 está en `Migraciones.kt`.
 *
 * Lo que la captura dice (presentación, precio o existencia, nombres para mostrar) va en
 * `payloadJson` (ver `ObservacionPayload`). Ese contenido NO cambia después de guardarse: si
 * cambiara, el reenvío de un lote ya no sería "el mismo lote" para el servidor.
 */
@Entity(
    tableName = "pending_visits",
    indices = [Index(value = ["captureId"], unique = true)],
)
data class PendingVisitEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val storeId: String,
    val latitude: Double,
    val longitude: Double,
    val payloadJson: String,
    val createdAtEpochMillis: Long,
    /**
     * true = ya está resuelta y no se vuelve a enviar (aceptada, duplicada, conflicto o rechazada
     * definitiva). false = falta enviarla o se debe reintentar.
     */
    val synced: Boolean = false,

    // ---- Versión 2 de la base (offline-sync-service, D-42) ----

    /** Folio de la captura: UUID generado en el teléfono. No cambia nunca, ni al reintentar. */
    val captureId: String,
    /** `precio_observado` o `disponibilidad` (ver `TipoCaptura`). */
    val tipo: String,
    /** Cuándo se hizo, ISO 8601 con zona horaria (p. ej. 2026-10-26T09:30:00-06:00). No cambia. */
    val capturedAt: String,
    /** Quién la capturó (id del token). Solo se envía con la sesión de esa persona. */
    val userId: String? = null,
    /** `pendiente` o el `status` del último acuse: aceptada, duplicada, conflicto, rechazada. */
    val estadoSync: String = EstadoSync.PENDIENTE,
    /** true solo si el acuse dijo `rechazada` con `retryable: true` (se vuelve a enviar). */
    val reintentable: Boolean = false,
    val motivoCodigo: String? = null,
    val motivoMensaje: String? = null,
    /** `target` del acuse: servicio destino y el id que asignó. */
    val destinoServicio: String? = null,
    val destinoId: String? = null,
    /** Solo en `duplicada`: lo que pasó la primera vez (`originalStatus`). */
    val estadoOriginal: String? = null,
    /** Solo en `conflicto`: cuándo se capturó el dato más reciente que ganó. */
    val serverCapturedAt: String? = null,
)

/** Valores de `estadoSync` (los cuatro últimos son los `status` de D-42). */
object EstadoSync {
    const val PENDIENTE = "pendiente"
    const val ACEPTADA = "aceptada"
    const val DUPLICADA = "duplicada"
    const val CONFLICTO = "conflicto"
    const val RECHAZADA = "rechazada"
}
