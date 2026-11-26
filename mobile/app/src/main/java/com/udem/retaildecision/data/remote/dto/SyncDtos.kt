package com.udem.retaildecision.data.remote.dto

/*
 * offline-sync-service, versión 1.0 del contrato (docs/contratos/offline-sync-service.md §4).
 * Gson NO escribe los campos nulos, y eso importa: el servidor responde 400 a cualquier campo que
 * no esté en el contrato, y una captura de disponibilidad solo lleva `content.stock`.
 */

/** Cuerpo de POST /v1/sync/batches (§4.1). El autor sale del token: aquí no va `userId`. */
data class LoteSyncDto(
    val batchId: String,
    val deviceId: String,
    val contractVersion: String,
    /** Siempre `movil` en esta app. */
    val client: String,
    /** ISO 8601 con zona horaria. Solo informativo: no forma parte de la huella del lote. */
    val sentAt: String?,
    val captures: List<CapturaSyncDto>,
)

data class CapturaSyncDto(
    val captureId: String,
    val type: String,
    val contractVersion: String,
    val capturedAt: String,
    val storeId: String,
    val presentationId: String,
    val content: ContenidoSyncDto,
)

/** `disponibilidad`: solo `stock`. `precio_observado`: `price` y, juntas, `lat`/`lng`. */
data class ContenidoSyncDto(
    val stock: Double? = null,
    val price: Double? = null,
    val lat: Double? = null,
    val lng: Double? = null,
)

/** Respuesta `200` de POST /v1/sync/batches: el acuse (§4.5). Todo opcional por si llega incompleto. */
data class AcuseLoteDto(
    val batchId: String? = null,
    val deviceId: String? = null,
    val userId: String? = null,
    val client: String? = null,
    val contractVersion: String? = null,
    val receivedAt: String? = null,
    val resend: Boolean? = null,
    val correlationId: String? = null,
    val summary: ResumenAcuseDto? = null,
    val results: List<ResultadoCapturaDto>? = null,
)

data class ResumenAcuseDto(
    val total: Int = 0,
    val aceptadas: Int = 0,
    val duplicadas: Int = 0,
    val conflictos: Int = 0,
    val rechazadas: Int = 0,
)

data class ResultadoCapturaDto(
    val captureId: String? = null,
    val type: String? = null,
    /** aceptada | duplicada | conflicto | rechazada (D-42). */
    val status: String? = null,
    /** Solo en `duplicada`: el resultado de la primera vez. */
    val originalStatus: String? = null,
    val capturedAt: String? = null,
    val target: DestinoSyncDto? = null,
    val serverCapturedAt: String? = null,
    val reason: MotivoSyncDto? = null,
    /** true solo si un destino no respondió: la captura se vuelve a enviar. */
    val retryable: Boolean? = null,
)

data class DestinoSyncDto(
    val service: String? = null,
    val id: String? = null,
)

data class MotivoSyncDto(
    val code: String? = null,
    val message: String? = null,
)
