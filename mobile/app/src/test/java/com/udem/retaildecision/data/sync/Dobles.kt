package com.udem.retaildecision.data.sync

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.udem.retaildecision.data.local.PendingVisitEntity
import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.remote.dto.AcuseLoteDto
import com.udem.retaildecision.data.remote.dto.DestinoSyncDto
import com.udem.retaildecision.data.remote.dto.MotivoSyncDto
import com.udem.retaildecision.data.remote.dto.ResultadoCapturaDto
import com.udem.retaildecision.data.repository.ObservacionPayload
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.Response
import java.io.IOException
import java.util.UUID

/** Base local en memoria: hace lo mismo que las consultas de PendingVisitDao que usa el Sincronizador. */
class AlmacenEnMemoria : AlmacenCapturas {
    val filas = linkedMapOf<String, PendingVisitEntity>()

    fun agregar(vararg nuevas: PendingVisitEntity) = nuevas.forEach { filas[it.captureId] = it }
    fun fila(captureId: String): PendingVisitEntity = filas.getValue(captureId)

    override suspend fun pendientesDe(userId: String) =
        filas.values.filter { !it.synced && (it.userId == userId || it.userId == null) }
            .sortedWith(compareBy({ it.createdAtEpochMillis }, { it.id }))

    override suspend fun porCaptureIds(captureIds: List<String>) = filas.values.filter { it.captureId in captureIds }

    override suspend fun actualizar(fila: PendingVisitEntity) {
        filas[fila.captureId] = fila
    }
}

class LoteEnMemoria : GuardaLoteEnCurso {
    var lote: LoteEnCurso? = null
    override fun leer() = lote
    override fun guardar(lote: LoteEnCurso) {
        this.lote = lote
    }
    override fun borrar() {
        lote = null
    }
}

/**
 * Hace de offline-sync-service: cada envío consume la siguiente respuesta programada y guarda el
 * cuerpo recibido. Una respuesta puede ser una excepción (sin red).
 */
class ServidorFalso : ClienteSync {
    val cuerpos = mutableListOf<String>()
    private val respuestas = ArrayDeque<(JsonObject) -> Response<AcuseLoteDto>>()

    fun responder(respuesta: (JsonObject) -> Response<AcuseLoteDto>) = respuestas.addLast(respuesta)
    fun responder(codigo: Int, mensaje: String = "error") = responder { respuestaError(codigo, mensaje) }
    fun sinRed() = responder { throw IOException("sin red") }

    /** Responde `status` a cada captura del lote, en orden. */
    fun acusar(vararg resultados: (String) -> ResultadoCapturaDto) = responder { lote ->
        val ids = lote.getAsJsonArray("captures").map { it.asJsonObject["captureId"].asString }
        Response.success(AcuseLoteDto(batchId = lote["batchId"].asString, results = ids.mapIndexed { i, id -> resultados[i](id) }))
    }

    override suspend fun enviar(cuerpoJson: String): Response<AcuseLoteDto> {
        cuerpos += cuerpoJson
        val respuesta = respuestas.removeFirstOrNull() ?: error("El servidor falso no tiene más respuestas programadas.")
        return respuesta(JsonParser.parseString(cuerpoJson).asJsonObject)
    }

    fun lote(i: Int): JsonObject = JsonParser.parseString(cuerpos[i]).asJsonObject
    fun ids(i: Int): List<String> = lote(i).getAsJsonArray("captures").map { it.asJsonObject["captureId"].asString }
}

fun respuestaError(codigo: Int, mensaje: String): Response<AcuseLoteDto> = Response.error(
    codigo,
    """{"statusCode":$codigo,"message":"$mensaje","code":"X","details":null,"path":"/v1/sync/batches","timestamp":"2026-10-30T15:02:01.120Z"}"""
        .toResponseBody("application/json".toMediaType()),
)

// ---- Resultados del acuse (contrato §4.5) ----

fun aceptada(service: String = "pricing-service"): (String) -> ResultadoCapturaDto = { id ->
    ResultadoCapturaDto(captureId = id, status = "aceptada", target = DestinoSyncDto(service, "destino-$id"), retryable = false)
}

fun duplicada(original: String, motivo: String? = null): (String) -> ResultadoCapturaDto = { id ->
    ResultadoCapturaDto(
        captureId = id, status = "duplicada", originalStatus = original,
        target = DestinoSyncDto("pricing-service", "destino-$id"),
        reason = motivo?.let { MotivoSyncDto("CONFLICT", it) }, retryable = false,
    )
}

fun conflicto(motivo: String = "El servidor ya tiene un dato más reciente."): (String) -> ResultadoCapturaDto = { id ->
    ResultadoCapturaDto(
        captureId = id, status = "conflicto", target = DestinoSyncDto("availability-service", id),
        serverCapturedAt = "2026-10-28T16:00:00.000Z", reason = MotivoSyncDto("CONFLICT", motivo), retryable = false,
    )
}

fun rechazada(motivo: String, reintentable: Boolean, code: String = "VALIDATION_ERROR"): (String) -> ResultadoCapturaDto = { id ->
    ResultadoCapturaDto(captureId = id, status = "rechazada", reason = MotivoSyncDto(code, motivo), retryable = reintentable)
}

// ---- Filas de prueba ----

const val USUARIO = "9d2e7f40-5a61-4c1b-8e3f-2b7c9a0d4e55"
const val TIENDA = "27f05c81-c6bf-456a-a273-150e4edb9900"
private val gson = Gson()
private var siguiente = 0L

fun precio(
    precio: Double = 27.5,
    userId: String? = USUARIO,
    presentationId: String = UUID.randomUUID().toString(),
): PendingVisitEntity = fila(TipoCaptura.PRECIO_OBSERVADO, ObservacionPayload(presentationId = presentationId, price = precio), userId)

fun existencia(stock: Double = 12.0, userId: String? = USUARIO): PendingVisitEntity =
    fila(TipoCaptura.DISPONIBILIDAD, ObservacionPayload(presentationId = UUID.randomUUID().toString(), stock = stock), userId)

internal fun fila(tipo: String, payload: ObservacionPayload, userId: String?): PendingVisitEntity {
    siguiente++
    return PendingVisitEntity(
        id = siguiente,
        storeId = TIENDA,
        latitude = 25.6866,
        longitude = -100.3161,
        payloadJson = gson.toJson(payload),
        createdAtEpochMillis = 1_761_000_000_000L + siguiente,
        captureId = UUID.randomUUID().toString(),
        tipo = tipo,
        capturedAt = "2026-10-26T09:30:00-06:00",
        userId = userId,
    )
}
