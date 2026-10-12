package com.udem.retaildecision.data.repository

import com.google.gson.Gson
import com.udem.retaildecision.data.local.PendingVisitDao
import com.udem.retaildecision.data.local.PendingVisitEntity
import com.udem.retaildecision.data.location.Ubicacion
import com.udem.retaildecision.data.remote.PricingApi
import com.udem.retaildecision.data.remote.dto.CreatePriceObservationRequest
import com.udem.retaildecision.data.remote.dto.PriceObservationDto
import com.udem.retaildecision.data.remote.dto.PresentacionDto
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.remote.mensajeDeError
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Lo que va dentro de `payloadJson` de cada captura. La tienda, la latitud y la longitud ya vienen
 * en columnas de la tabla; aquí va lo demás. Lo usan este repositorio y el SyncWorker.
 *
 * `error` solo se llena cuando el servidor rechazó la captura y reintentar no sirve (por ejemplo,
 * la presentación ya no existe o el rol no puede capturar). Con `error` la fila queda marcada como
 * "ya procesada" para que no se reintente para siempre.
 */
internal data class ObservacionPayload(
    val storeName: String? = null,
    val productName: String? = null,
    val presentationId: String = "",
    val presentationName: String? = null,
    val price: Double = 0.0,
    /** ISO 8601 en UTC, por ejemplo 2026-10-12T18:30:00Z. */
    val observedAt: String = "",
    val precisionMetros: Float? = null,
    val distanciaATiendaMetros: Int? = null,
    val error: String? = null,
    /** Id de la observación en pricing-service; se llena al enviarla. */
    val serverId: String? = null,
    /** "aprobado" o "rechazado" cuando el Responsable de precios ya decidió. */
    val decision: String? = null,
    val motivoDecision: String? = null,
)

internal fun fechaIsoUtc(millis: Long): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .format(Date(millis))

/** Arma el body de POST /v1/price-observations a partir de una fila guardada. */
internal fun PendingVisitEntity.aSolicitud(payload: ObservacionPayload) = CreatePriceObservationRequest(
    presentationId = payload.presentationId,
    storeId = storeId,
    price = payload.price,
    observedAt = payload.observedAt.ifBlank { null },
    lat = latitude,
    lng = longitude,
)

/**
 * PENDIENTE: guardada en el teléfono, falta enviarla.
 * ENVIADA: el servidor la recibió; espera la decisión del Responsable de precios.
 * APROBADA / RECHAZADA: decisión del Responsable de precios (RECHAZADA trae su motivo).
 * NO_ACEPTADA: el servidor no quiso recibirla (dato inválido, rol sin permiso...); no se reintenta.
 */
enum class EstadoCaptura { PENDIENTE, ENVIADA, APROBADA, RECHAZADA, NO_ACEPTADA }

/** Una captura guardada en el teléfono, lista para mostrarse. */
data class ObservacionGuardada(
    val id: Long,
    val tiendaNombre: String,
    val productoNombre: String,
    val presentacionNombre: String?,
    val precio: Double,
    val latitud: Double,
    val longitud: Double,
    val precisionMetros: Float?,
    val distanciaATiendaMetros: Int?,
    val creadaEn: Long,
    val estado: EstadoCaptura,
    val motivoRechazo: String?,
)

/**
 * Guarda y lista los precios levantados en tienda en la base local (Room). Funciona sin internet.
 * El envío a pricing-service (POST /v1/price-observations) lo hace SyncWorker cuando hay red.
 * Se reutiliza la tabla `pending_visits`: sus columnas (tienda, lat, lon, payload, enviada) sirven tal cual.
 */
class ObservationRepository(
    private val dao: PendingVisitDao,
    private val api: PricingApi,
    private val onSesionExpirada: () -> Unit = {},
) {

    private val gson = Gson()

    fun capturas(): Flow<List<ObservacionGuardada>> =
        dao.observeAll().map { lista -> lista.map { it.aCaptura() } }

    suspend fun guardar(
        tienda: StoreDto,
        producto: ProductDto,
        presentacion: PresentacionDto,
        precio: Double,
        ubicacion: Ubicacion,
        distanciaATiendaMetros: Int?,
    ): Result<Long> = try {
        val ahora = System.currentTimeMillis()
        val payload = ObservacionPayload(
            storeName = tienda.nombre,
            productName = producto.nombre,
            presentationId = presentacion.id,
            presentationName = presentacion.nombre,
            price = precio,
            observedAt = fechaIsoUtc(ahora),
            precisionMetros = ubicacion.precisionMetros,
            distanciaATiendaMetros = distanciaATiendaMetros,
        )
        val id = dao.insert(
            PendingVisitEntity(
                storeId = tienda.id,
                latitude = ubicacion.latitud,
                longitude = ubicacion.longitud,
                payloadJson = gson.toJson(payload),
                createdAtEpochMillis = ahora,
            ),
        )
        Result.success(id)
    } catch (e: Exception) {
        Result.failure(Exception("No se pudo guardar el precio en el teléfono."))
    }

    /**
     * Le pregunta al servidor (GET /v1/price-observations; el Analista recibe solo las suyas) si el
     * Responsable de precios ya aprobó o rechazó las capturas enviadas. Regresa cuántas cambiaron.
     * Las capturas enviadas antes de esta versión no traen id del servidor y no se pueden actualizar.
     */
    suspend fun actualizarDecisiones(): Result<Int> {
        return try {
            val porRevisar = dao.getSynced().mapNotNull { fila ->
                val payload = runCatching { gson.fromJson(fila.payloadJson, ObservacionPayload::class.java) }.getOrNull()
                if (payload != null && payload.serverId != null && payload.decision == null && payload.error == null) fila to payload else null
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
            for ((fila, payload) in porRevisar) {
                val remota = remotas[payload.serverId] ?: continue
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
        // Filas de la versión anterior ("visitas" sin contrato en el servidor): no tienen presentación y no se pueden enviar.
        val anterior = payload == null || payload.presentationId.isBlank()
        val estado = when {
            anterior || payload?.error != null -> EstadoCaptura.NO_ACEPTADA
            payload?.decision == "aprobado" -> EstadoCaptura.APROBADA
            payload?.decision == "rechazado" -> EstadoCaptura.RECHAZADA
            synced -> EstadoCaptura.ENVIADA
            else -> EstadoCaptura.PENDIENTE
        }
        return ObservacionGuardada(
            id = id,
            tiendaNombre = payload?.storeName ?: "Tienda",
            productoNombre = payload?.productName ?: "Registro anterior",
            presentacionNombre = payload?.presentationName,
            precio = payload?.price ?: 0.0,
            latitud = latitude,
            longitud = longitude,
            precisionMetros = payload?.precisionMetros,
            distanciaATiendaMetros = payload?.distanciaATiendaMetros,
            creadaEn = createdAtEpochMillis,
            estado = estado,
            motivoRechazo = when {
                anterior -> "Registro de una versión anterior de la app; no se puede enviar."
                else -> payload?.error ?: payload?.motivoDecision
            },
        )
    }
}