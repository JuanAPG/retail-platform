package com.udem.retaildecision.data.repository

import com.udem.retaildecision.data.remote.AvailabilityApi
import com.udem.retaildecision.data.remote.SegmentationApi
import com.udem.retaildecision.data.remote.dto.ZoneClassificationDto
import com.udem.retaildecision.data.remote.dto.ZoneCoverageDto
import java.io.IOException

/** No hubo red: la pantalla lo dice como "No disponible sin conexión", no como un error. */
class SinConexionException : Exception("No disponible sin conexión.")

/**
 * Lo que se sabe de una zona fuera del catálogo: su nivel de ingreso (income-segmentation-service) y su
 * cobertura de básicos (availability-service). Las dos lecturas son SOLO de los 6 perfiles internos; quien
 * llama decide no pedirlas para el Investigador de mercado (D-28: le responderían 403).
 *
 * Nada de esto se guarda en el teléfono: si no hay red, la pantalla lo oculta con un aviso.
 */
class ZoneInsightsRepository(
    private val segmentationApi: SegmentationApi,
    private val availabilityApi: AvailabilityApi,
    /** Se llama cuando el servidor responde 401: la sesión ya no sirve y hay que volver al login. */
    private val onSesionExpirada: () -> Unit = {},
) {

    /** Clasificación vigente de todas las zonas (todas las páginas). */
    suspend fun clasificacionesVigentes(): Result<List<ZoneClassificationDto>> = protegido {
        val todas = mutableListOf<ZoneClassificationDto>()
        var page = 1
        while (true) {
            val res = segmentationApi.getZoneClassifications(current = true, page = page)
            if (res.code() == 401) onSesionExpirada()
            val body = res.body()
            if (!res.isSuccessful || body == null) throw Exception(mensajeHttp(res.code()))
            todas += body.data
            if (todas.size >= body.total || body.data.isEmpty()) break
            page++
        }
        todas
    }

    /** Clasificación vigente de una zona; `null` si la zona no tiene ninguna (404 del contrato). */
    suspend fun clasificacion(zonaId: String): Result<ZoneClassificationDto?> = protegido {
        val res = segmentationApi.getZoneClassification(zonaId)
        if (res.code() == 401) onSesionExpirada()
        when {
            res.code() == 404 -> null
            res.isSuccessful -> res.body() ?: throw Exception("El servidor respondió sin datos.")
            else -> throw Exception(mensajeHttp(res.code()))
        }
    }

    /** Cobertura de básicos de la zona. `disponible: false` es una respuesta válida, no un error. */
    suspend fun cobertura(zonaId: String): Result<ZoneCoverageDto> = protegido {
        val res = availabilityApi.getZoneCoverage(zonaId)
        if (res.code() == 401) onSesionExpirada()
        val body = res.body()
        if (res.isSuccessful && body != null) body else throw Exception(mensajeHttp(res.code()))
    }

    private suspend fun <T> protegido(bloque: suspend () -> T): Result<T> = try {
        Result.success(bloque())
    } catch (e: IOException) {
        Result.failure(SinConexionException())
    } catch (e: Exception) {
        Result.failure(Exception(e.message ?: "No disponible por ahora."))
    }

    private fun mensajeHttp(code: Int): String = when (code) {
        401 -> "Tu sesión expiró. Vuelve a iniciar sesión."
        403 -> "Tu rol no tiene permiso para ver esta información."
        else -> "El servidor respondió con error ($code)."
    }
}
