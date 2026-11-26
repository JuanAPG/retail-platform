package com.udem.retaildecision.data.repository

import com.google.gson.Gson
import com.udem.retaildecision.data.local.EstadoSync
import com.udem.retaildecision.data.local.PendingVisitDao
import com.udem.retaildecision.data.local.PendingVisitEntity
import com.udem.retaildecision.data.location.Ubicacion
import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.remote.PricingApi
import com.udem.retaildecision.data.remote.dto.PriceObservationDto
import com.udem.retaildecision.data.remote.dto.PresentacionDto
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.remote.mensajeDeError
import com.udem.retaildecision.data.sync.fechaIsoConZona
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.io.IOException
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Lo que va dentro de `payloadJson` de cada captura. La tienda, la latitud y la longitud ya vienen
 * en columnas de la tabla; aquí va lo demás. Lo usan este repositorio y el Sincronizador.
 *
 * `presentationId`, `price` y `stock` son el contenido de la captura y no cambian después de
 * guardarse. `serverId`, `decision`, `motivoDecision` y `error` son seguimiento.
 */
internal data class ObservacionPayload(
    val storeName: String? = null,
    val productName: String? = null,
    val presentationId: String = "",
    val presentationName: String? = null,
    /** precio_observado: MXN por presentación. */
    val price: Double = 0.0,
    /** disponibilidad: existencia en unidades de la presentación (0 = agotado). */
    val stock: Double? = null,
    /** ISO 8601 en UTC, por ejemplo 2026-10-12T18:30:00Z (versión 1 de la app). */
    val observedAt: String = "",
    val precisionMetros: Float? = null,
    val distanciaATiendaMetros: Int? = null,
    /** Motivo de rechazo de pricing-service en la versión 1 de la app (antes de offline-sync). */
    val error: String? = null,
    /** Id de la observación en pricing-service en la versión 1 de la app. Hoy sale del acuse (`destinoId`). */
    val serverId: String? = null,
    /** "aprobado" o "rechazado" cuando el Responsable de precios ya decidió. */
    val decision: String? = null,
    val motivoDecision: String? = null,
)

internal fun fechaIsoUtc(millis: Long): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .format(Date(millis))

/**
 * Arma la fila de una captura nueva. Aquí nace su folio (`captureId`, UUID del dispositivo) y su
 * hora con zona horaria (`capturedAt`). Ninguno de los dos cambia después: ni al reintentar el
 * envío ni al cerrar la app, porque quedan guardados en la base del teléfono (D-42).
 */
internal fun nuevaCaptura(
    tipo: String,
    userId: String?,
    storeId: String,
    latitud: Double,
    longitud: Double,
    payload: ObservacionPayload,
    ahoraMillis: Long,
    zona: ZoneId = ZoneId.systemDefault(),
    nuevoId: () -> String = { UUID.randomUUID().toString() },
    gson: Gson = Gson(),
): PendingVisitEntity = PendingVisitEntity(
    storeId = storeId,
    latitude = latitud,
    longitude = longitud,
    payloadJson = gson.toJson(payload),
    createdAtEpochMillis = ahoraMillis,
    captureId = nuevoId(),
    tipo = tipo,
    capturedAt = fechaIsoConZona(OffsetDateTime.ofInstant(Instant.ofEpochMilli(ahoraMillis), zona)),
    userId = userId,
)

/**
 * PENDIENTE: guardada en el teléfono, falta enviarla.
 * REINTENTO: el servidor la rechazó porque un destino no respondió; se vuelve a enviar sola.
 * ENVIADA: aceptada (o duplicada de una aceptada). Un precio queda en espera del Responsable de precios.
 * CONFLICTO: el servidor ya tenía un dato más reciente (D-42); no se sobrescribió y no se reintenta.
 * NO_ACEPTADA: rechazada definitiva (dato inválido, rol sin permiso...); trae su motivo.
 * APROBADA / RECHAZADA: decisión del Responsable de precios sobre un precio enviado.
 */
enum class EstadoCaptura { PENDIENTE, REINTENTO, ENVIADA, CONFLICTO, NO_ACEPTADA, APROBADA, RECHAZADA }

/** Una captura guardada en el teléfono, lista para mostrarse. */
data class ObservacionGuardada(
    val id: Long,
    val captureId: String,
    val tipo: String,
    val tiendaNombre: String,
    val productoNombre: String,
    val presentacionNombre: String?,
    /** precio_observado. */
    val precio: Double?,
    /** disponibilidad. */
    val existencia: Double?,
    val latitud: Double,
    val longitud: Double,
    val precisionMetros: Float?,
    val distanciaATiendaMetros: Int?,
    val creadaEn: Long,
    val estado: EstadoCaptura,
    /** Motivo de un conflicto, de un rechazo (definitivo o reintentable) o de la decisión. */
    val motivo: String?,
)

private const val MENSAJE_VERSION_ANTERIOR = "Registro de una versión anterior de la app; no se puede enviar."

/** Qué estado y qué motivo se muestran para una fila, según el último acuse guardado. */
internal fun estadoVisible(fila: PendingVisitEntity, payload: ObservacionPayload?): Pair<EstadoCaptura, String?> {
    if (payload == null || payload.presentationId.isBlank()) return EstadoCaptura.NO_ACEPTADA to MENSAJE_VERSION_ANTERIOR
    val motivo = fila.motivoMensaje ?: payload.error

    val (estado, texto) = when (fila.estadoSync) {
        EstadoSync.PENDIENTE -> EstadoCaptura.PENDIENTE to null
        EstadoSync.ACEPTADA -> EstadoCaptura.ENVIADA to null
        EstadoSync.CONFLICTO -> EstadoCaptura.CONFLICTO to motivo
        EstadoSync.RECHAZADA ->
            if (fila.reintentable) EstadoCaptura.REINTENTO to motivo else EstadoCaptura.NO_ACEPTADA to motivo
        // Ya había llegado antes: lo que cuenta es lo que pasó la primera vez.
        EstadoSync.DUPLICADA -> when (fila.estadoOriginal) {
            EstadoSync.CONFLICTO -> EstadoCaptura.CONFLICTO to motivo
            EstadoSync.RECHAZADA -> EstadoCaptura.NO_ACEPTADA to motivo
            else -> EstadoCaptura.ENVIADA to null
        }
        else -> EstadoCaptura.PENDIENTE to null
    }
    if (estado == EstadoCaptura.ENVIADA) {
        when (payload.decision) {
            "aprobado" -> return EstadoCaptura.APROBADA to null
            "rechazado" -> return EstadoCaptura.RECHAZADA to payload.motivoDecision
        }
    }
    return estado to texto
}

/**
 * Guarda y lista las capturas de campo en la base local (Room). Funciona sin internet.
 * El envío a offline-sync-service lo hace SyncWorker cuando hay red.
 */
class ObservationRepository(
    private val dao: PendingVisitDao,
    private val api: PricingApi,
    /** Id del usuario con sesión: dueño de lo que se captura. */
    private val usuarioActual: () -> String?,
    private val onSesionExpirada: () -> Unit = {},
) {

    private val gson = Gson()

    fun capturas(): Flow<List<ObservacionGuardada>> =
        dao.observeAll().map { lista -> lista.map { it.aCaptura() } }

    /**
     * @param valor el precio (precio_observado) o la existencia (disponibilidad).
     */
    suspend fun guardar(
        tipo: String,
        tienda: StoreDto,
        producto: ProductDto,
        presentacion: PresentacionDto,
        valor: Double,
        ubicacion: Ubicacion,
        distanciaATiendaMetros: Int?,
    ): Result<Long> = try {
        val ahora = System.currentTimeMillis()
        val esPrecio = tipo == TipoCaptura.PRECIO_OBSERVADO
        val payload = ObservacionPayload(
            storeName = tienda.nombre,
            productName = producto.nombre,
            presentationId = presentacion.id,
            presentationName = presentacion.nombre,
            price = if (esPrecio) valor else 0.0,
            stock = if (esPrecio) null else valor,
            observedAt = fechaIsoUtc(ahora),
            precisionMetros = ubicacion.precisionMetros,
            distanciaATiendaMetros = distanciaATiendaMetros,
        )
        val fila = nuevaCaptura(
            tipo = tipo,
            userId = usuarioActual(),
            storeId = tienda.id,
            latitud = ubicacion.latitud,
            longitud = ubicacion.longitud,
            payload = payload,
            ahoraMillis = ahora,
            gson = gson,
        )
        Result.success(dao.insert(fila))
    } catch (e: Exception) {
        Result.failure(Exception("No se pudo guardar la captura en el teléfono."))
    }

    /**
     * Le pregunta a pricing-service (GET /v1/price-observations) si el Responsable de precios ya
     * aprobó o rechazó los precios enviados. Regresa cuántos cambiaron. Solo para los roles que
     * pueden leer esa ruta (el Investigador de mercado no: pricing le responde 403).
     */
    suspend fun actualizarDecisiones(): Result<Int> {
        return try {
            val porRevisar = dao.getSynced().mapNotNull { fila ->
                val payload = runCatching { gson.fromJson(fila.payloadJson, ObservacionPayload::class.java) }.getOrNull()
                    ?: return@mapNotNull null
                val idPricing = when {
                    fila.tipo != TipoCaptura.PRECIO_OBSERVADO -> null
                    fila.destinoServicio == "pricing-service" && fila.destinoId != null -> fila.destinoId
                    else -> payload.serverId
                }
                val (estado, _) = estadoVisible(fila, payload)
                if (idPricing != null && estado == EstadoCaptura.ENVIADA) Triple(fila, payload, idPricing) else null
            }
            if (porRevisar.isEmpty()) return Result.success(0)

            val remotas = mutableMapOf<String, PriceObservationDto>()
            var page = 1
            while (true) {
                val res = api.getObservations(page = page)
                if (res.code() == 401) onSesionExpirada()
                if (!res.isSuccessful) {
                    return Result.failure(Exception(mensajeDeError(res, "No se pudo consultar el estado (${res.code()}).")))
                }
                val body = res.body() ?: return Result.failure(Exception("El servidor respondió sin datos."))
                body.data.forEach { remotas[it.id] = it }
                if (remotas.size >= body.total || body.data.isEmpty()) break
                page++
            }

            var cambios = 0
            for ((fila, payload, idPricing) in porRevisar) {
                val remota = remotas[idPricing] ?: continue
                if (remota.status == "aprobado" || remota.status == "rechazado") {
                    val nuevo = payload.copy(decision = remota.status, motivoDecision = remota.rejectionReason)
                    dao.update(fila.copy(payloadJson = gson.toJson(nuevo)))
                    cambios++
                }
            }
            Result.success(cambios)
        } catch (e: IOException) {
            Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudo consultar el estado de tus capturas."))
        }
    }

    private fun PendingVisitEntity.aCaptura(): ObservacionGuardada {
        val payload = runCatching { gson.fromJson(payloadJson, ObservacionPayload::class.java) }.getOrNull()
        val (estado, motivo) = estadoVisible(this, payload)
        val esPrecio = tipo == TipoCaptura.PRECIO_OBSERVADO
        return ObservacionGuardada(
            id = id,
            captureId = captureId,
            tipo = tipo,
            tiendaNombre = payload?.storeName ?: "Tienda",
            productoNombre = payload?.productName ?: "Registro anterior",
            presentacionNombre = payload?.presentationName,
            precio = if (esPrecio) payload?.price else null,
            existencia = if (esPrecio) null else payload?.stock,
            latitud = latitude,
            longitud = longitude,
            precisionMetros = payload?.precisionMetros,
            distanciaATiendaMetros = payload?.distanciaATiendaMetros,
            creadaEn = createdAtEpochMillis,
            estado = estado,
            motivo = motivo,
        )
    }
}
