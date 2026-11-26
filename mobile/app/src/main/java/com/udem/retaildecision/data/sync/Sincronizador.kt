package com.udem.retaildecision.data.sync

import com.google.gson.Gson
import com.udem.retaildecision.data.local.EstadoSync
import com.udem.retaildecision.data.local.PendingVisitEntity
import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.remote.dto.AcuseLoteDto
import com.udem.retaildecision.data.remote.dto.CapturaSyncDto
import com.udem.retaildecision.data.remote.dto.ContenidoSyncDto
import com.udem.retaildecision.data.remote.dto.LoteSyncDto
import com.udem.retaildecision.data.remote.dto.ResultadoCapturaDto
import com.udem.retaildecision.data.remote.mensajeDeError
import com.udem.retaildecision.data.repository.ObservacionPayload
import retrofit2.Response
import java.io.IOException
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

/*
 * Envío de capturas a offline-sync-service (contrato docs/contratos/offline-sync-service.md, D-42).
 * Aquí no hay nada de Android: el SyncWorker conecta Room, SharedPreferences y Retrofit, y las
 * pruebas unitarias (SincronizadorTest) conectan versiones en memoria.
 */

/** Versión del contrato que habla esta app (§3). */
const val VERSION_CONTRATO = "1.0"

/** Máximo de capturas por lote. El contrato acepta hasta 500 y 1 MB; 100 capturas son unos 40 KB. */
const val TAMANO_LOTE = 100

/**
 * Un `409` en el mismo lote puede ser "se está procesando" (el candado dura 60 s) o "ese batchId
 * ya se usó con otro contenido". El primero se resuelve solo al reintentar; si después de 3
 * intentos sigue, el lote se rearma con un batchId nuevo (los folios de las capturas no cambian).
 */
const val MAXIMO_409 = 3

/** Lo que el sincronizador necesita de la base local (Room en la app, una lista en las pruebas). */
interface AlmacenCapturas {
    suspend fun pendientesDe(userId: String): List<PendingVisitEntity>
    suspend fun porCaptureIds(captureIds: List<String>): List<PendingVisitEntity>
    suspend fun actualizar(fila: PendingVisitEntity)
}

/**
 * El lote que se mandó y del que todavía no llega el acuse. Se guarda ANTES de enviarlo: si la
 * respuesta se pierde (sin red, 5xx, la app se cierra), el siguiente intento manda el MISMO lote
 * (mismo `batchId`, mismos bytes) y el servidor devuelve el acuse sin repetir nada (§4.8).
 */
data class LoteEnCurso(
    val batchId: String,
    val userId: String,
    val captureIds: List<String>,
    val cuerpoJson: String,
    val respuestas409: Int = 0,
)

interface GuardaLoteEnCurso {
    fun leer(): LoteEnCurso?
    fun guardar(lote: LoteEnCurso)
    fun borrar()
}

/** POST /v1/sync/batches con el cuerpo ya armado. */
fun interface ClienteSync {
    suspend fun enviar(cuerpoJson: String): Response<AcuseLoteDto>
}

enum class ResultadoSync {
    /** No queda nada que enviar en esta sesión (o lo que queda ya tiene un estado final). */
    LISTO,

    /** Algo quedó pendiente (sin red, 401, 429, 5xx, 409, capturas reintentables): WorkManager vuelve a intentar. */
    REINTENTAR,
}

/** ISO 8601 con segundos y zona horaria (`Z` o `±hh:mm`), como pide el contrato (§3). */
private val FORMATO_ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)

fun fechaIsoConZona(instante: OffsetDateTime): String = instante.format(FORMATO_ISO)

class Sincronizador(
    private val almacen: AlmacenCapturas,
    private val enCurso: GuardaLoteEnCurso,
    private val cliente: ClienteSync,
    private val deviceId: String,
    private val nuevoId: () -> String = { UUID.randomUUID().toString() },
    private val ahora: () -> OffsetDateTime = { OffsetDateTime.now() },
    private val tamanoLote: Int = TAMANO_LOTE,
) {
    private val gson = Gson()

    /**
     * Manda todo lo pendiente de `userId`, en lotes. Cada captura se envía a lo más una vez por
     * corrida: las reintentables esperan al siguiente intento de WorkManager (con su espera
     * exponencial) en vez de golpear en seguida a un destino que no responde.
     */
    suspend fun sincronizar(userId: String): ResultadoSync {
        val enviadas = mutableSetOf<String>()
        var tamano = tamanoLote
        var quedaPendiente = false

        while (true) {
            var lote = enCurso.leer()
            // Un lote de otra sesión no se manda con este token: el autor sale del token (§2).
            if (lote != null && lote.userId != userId) {
                enCurso.borrar()
                lote = null
            }
            if (lote == null) {
                lote = armarLote(userId, enviadas, tamano) ?: break
                enCurso.guardar(lote)
            }

            val respuesta = try {
                cliente.enviar(lote.cuerpoJson)
            } catch (e: IOException) {
                // Sin red o se cortó a medio envío. El lote queda guardado y se reenvía igual.
                return ResultadoSync.REINTENTAR
            }

            val codigo = respuesta.code()
            when {
                respuesta.isSuccessful -> {
                    // Un 200 sin acuse legible es como una respuesta perdida: el reenvío lo recupera.
                    val resultados = respuesta.body()?.results ?: return ResultadoSync.REINTENTAR
                    if (aplicarAcuse(lote, resultados)) quedaPendiente = true
                    enCurso.borrar()
                    enviadas += lote.captureIds
                }

                // Sesión, límite de peticiones o servidor (incluye 503 con Mongo o Redis caídos): no se
                // procesó nada (§4.10). Se reintenta el MISMO lote, sin cambiar folios ni batchId.
                codigo == 401 || codigo == 429 || codigo >= 500 -> return ResultadoSync.REINTENTAR

                codigo == 409 -> {
                    val intentos = lote.respuestas409 + 1
                    if (intentos >= MAXIMO_409) enCurso.borrar() else enCurso.guardar(lote.copy(respuestas409 = intentos))
                    return ResultadoSync.REINTENTAR
                }

                // Lote demasiado grande: se arma otro con la mitad (los folios no cambian).
                codigo == 413 && lote.captureIds.size > 1 -> {
                    enCurso.borrar()
                    tamano = maxOf(1, lote.captureIds.size / 2)
                }

                // 400, 403 y demás 4xx: el lote completo no se procesó y reintentarlo igual no cambia
                // nada. Cada captura queda rechazada con el motivo, visible en la lista; no se borra.
                else -> {
                    val motivo = mensajeDeError(respuesta, "El servidor rechazó el lote ($codigo).")
                    rechazarLote(lote, codigoDeError(codigo), motivo)
                    enCurso.borrar()
                    enviadas += lote.captureIds
                }
            }
        }
        return if (quedaPendiente) ResultadoSync.REINTENTAR else ResultadoSync.LISTO
    }

    private suspend fun armarLote(userId: String, excluir: Set<String>, tamano: Int): LoteEnCurso? {
        val filas = mutableListOf<PendingVisitEntity>()
        val capturas = mutableListOf<CapturaSyncDto>()
        for (fila in almacen.pendientesDe(userId)) {
            if (filas.size >= tamano) break
            if (fila.captureId in excluir) continue
            val captura = aCapturaSync(fila, gson)
            if (captura == null) {
                almacen.actualizar(rechazoLocal(fila))
                continue
            }
            // Una fila sin dueño (anterior a la versión 2 de la base) pasa a ser de quien la envía.
            val propia = if (fila.userId == null) fila.copy(userId = userId).also { almacen.actualizar(it) } else fila
            filas += propia
            capturas += captura
        }
        if (capturas.isEmpty()) return null

        val batchId = nuevoId()
        val cuerpo = LoteSyncDto(
            batchId = batchId,
            deviceId = deviceId,
            contractVersion = VERSION_CONTRATO,
            client = "movil",
            sentAt = fechaIsoConZona(ahora()),
            captures = capturas,
        )
        return LoteEnCurso(batchId, userId, filas.map { it.captureId }, gson.toJson(cuerpo))
    }

    /** @return true si alguna captura del lote sigue pendiente (reintentable o sin resultado). */
    private suspend fun aplicarAcuse(lote: LoteEnCurso, resultados: List<ResultadoCapturaDto>): Boolean {
        val porId = resultados.filter { it.captureId != null }.associateBy { it.captureId }
        var quedaPendiente = false
        for (fila in almacen.porCaptureIds(lote.captureIds)) {
            val resultado = porId[fila.captureId]
            if (resultado == null) {
                quedaPendiente = true
                continue
            }
            val nueva = aplicarResultado(fila, resultado)
            if (!nueva.synced) quedaPendiente = true
            almacen.actualizar(nueva)
        }
        return quedaPendiente
    }

    private suspend fun rechazarLote(lote: LoteEnCurso, codigo: String, motivo: String) {
        for (fila in almacen.porCaptureIds(lote.captureIds)) {
            almacen.actualizar(
                fila.copy(
                    synced = true,
                    estadoSync = EstadoSync.RECHAZADA,
                    reintentable = false,
                    motivoCodigo = codigo,
                    motivoMensaje = motivo,
                ),
            )
        }
    }
}

private fun codigoDeError(http: Int): String = when (http) {
    400, 413 -> "VALIDATION_ERROR"
    403 -> "FORBIDDEN"
    404 -> "NOT_FOUND"
    else -> "HTTP_$http"
}

/**
 * Convierte una fila guardada en la captura del contrato. `null` si la fila no se puede enviar
 * (por ejemplo, un registro de la primera versión de la app, sin presentación).
 */
internal fun aCapturaSync(fila: PendingVisitEntity, gson: Gson = Gson()): CapturaSyncDto? {
    val payload = runCatching { gson.fromJson(fila.payloadJson, ObservacionPayload::class.java) }.getOrNull()
        ?: return null
    if (payload.presentationId.isBlank() || fila.capturedAt.isBlank()) return null
    val contenido = when (fila.tipo) {
        TipoCaptura.PRECIO_OBSERVADO -> {
            if (payload.price <= 0.0) return null
            ContenidoSyncDto(price = payload.price, lat = fila.latitude, lng = fila.longitude)
        }
        // El contrato no admite ubicación en disponibilidad (§4.4): se queda solo en el teléfono.
        TipoCaptura.DISPONIBILIDAD -> {
            val stock = payload.stock ?: return null
            if (stock < 0.0) return null
            ContenidoSyncDto(stock = stock)
        }
        else -> return null
    }
    return CapturaSyncDto(
        captureId = fila.captureId,
        type = fila.tipo,
        contractVersion = VERSION_CONTRATO,
        capturedAt = fila.capturedAt,
        storeId = fila.storeId,
        presentationId = payload.presentationId,
        content = contenido,
    )
}

/** Una fila que ni siquiera se puede armar como captura: queda rechazada sin ir al servidor. */
internal fun rechazoLocal(fila: PendingVisitEntity): PendingVisitEntity = fila.copy(
    synced = true,
    estadoSync = EstadoSync.RECHAZADA,
    reintentable = false,
    motivoCodigo = "VALIDATION_ERROR",
    motivoMensaje = "Registro incompleto o de una versión anterior de la app; no se puede enviar.",
)

/**
 * Guarda en la fila lo que dijo el acuse para esa captura (D-42):
 * - `aceptada`: enviada.
 * - `duplicada`: ya había llegado antes; se guarda `originalStatus` (lo que pasó la primera vez).
 * - `conflicto`: el servidor tenía un dato más reciente; queda con su motivo y no se reintenta.
 * - `rechazada` con `retryable: true`: sigue pendiente y se reenvía con el mismo folio.
 * - `rechazada` definitiva: queda con su motivo para mostrarlo.
 * Un `status` desconocido no cambia la fila (sigue pendiente).
 */
internal fun aplicarResultado(fila: PendingVisitEntity, r: ResultadoCapturaDto): PendingVisitEntity {
    val conDestino = fila.copy(
        destinoServicio = r.target?.service ?: fila.destinoServicio,
        destinoId = r.target?.id ?: fila.destinoId,
        motivoCodigo = r.reason?.code,
        motivoMensaje = r.reason?.message,
        serverCapturedAt = r.serverCapturedAt,
        estadoOriginal = null,
    )
    return when (r.status) {
        EstadoSync.ACEPTADA -> conDestino.copy(synced = true, estadoSync = EstadoSync.ACEPTADA, reintentable = false)
        EstadoSync.DUPLICADA -> conDestino.copy(
            synced = true,
            estadoSync = EstadoSync.DUPLICADA,
            reintentable = false,
            estadoOriginal = r.originalStatus ?: EstadoSync.ACEPTADA,
        )
        EstadoSync.CONFLICTO -> conDestino.copy(synced = true, estadoSync = EstadoSync.CONFLICTO, reintentable = false)
        EstadoSync.RECHAZADA -> {
            val reintentar = r.retryable == true
            conDestino.copy(synced = !reintentar, estadoSync = EstadoSync.RECHAZADA, reintentable = reintentar)
        }
        else -> fila
    }
}
