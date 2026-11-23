package com.udem.retaildecision.data.repository

import com.udem.retaildecision.data.remote.PricingApi
import com.udem.retaildecision.data.remote.dto.PriceObservationDto
import com.udem.retaildecision.data.remote.dto.RejectPriceBody
import com.udem.retaildecision.data.remote.mensajeDeError
import retrofit2.Response
import java.io.IOException

/** Revisión de precios levantados en campo (D-16): el Responsable de precios aprueba o rechaza. */
class PriceReviewRepository(
    private val api: PricingApi,
    private val onSesionExpirada: () -> Unit = {},
) {

    /** Las pendientes, la más antigua primero (así las ordena el servidor). Todas las páginas. */
    suspend fun pendientes(): Result<List<PriceObservationDto>> {
        return try {
            val todas = mutableListOf<PriceObservationDto>()
            var page = 1
            while (true) {
                val res = api.getObservations(status = "pendiente", page = page)
                if (res.code() == 401) onSesionExpirada()
                if (!res.isSuccessful) {
                    return Result.failure(Exception(mensajeDeError(res, mensajeHttp(res.code()))))
                }
                val body = res.body() ?: return Result.failure(Exception("El servidor respondió sin datos."))
                todas += body.data
                if (todas.size >= body.total || body.data.isEmpty()) break
                page++
            }
            Result.success(todas)
        } catch (e: IOException) {
            Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudieron leer los precios por revisar."))
        }
    }

    suspend fun aprobar(id: String): Result<Unit> = resolver { api.approveObservation(id, emptyMap()) }

    suspend fun rechazar(id: String, motivo: String): Result<Unit> =
        resolver { api.rejectObservation(id, RejectPriceBody(motivo.trim())) }

    private suspend fun resolver(llamada: suspend () -> Response<Unit>): Result<Unit> {
        return try {
            val res = llamada()
            if (res.code() == 401) onSesionExpirada()
            if (res.isSuccessful) Result.success(Unit)
            else Result.failure(Exception(mensajeDeError(res, mensajeHttp(res.code()))))
        } catch (e: IOException) {
            Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudo completar la acción."))
        }
    }

    private fun mensajeHttp(code: Int): String = when (code) {
        401 -> "Tu sesión expiró. Vuelve a iniciar sesión."
        403 -> "Solo el Responsable de precios puede aprobar o rechazar precios."
        404 -> "Esa captura ya no existe."
        409 -> "Esa captura ya fue resuelta, o su fecha no es posterior al precio vigente. Actualiza la lista."
        else -> "El servidor respondió con error ($code)."
    }
}