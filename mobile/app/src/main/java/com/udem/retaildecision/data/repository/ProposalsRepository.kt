package com.udem.retaildecision.data.repository

import com.udem.retaildecision.data.remote.PricingApi
import com.udem.retaildecision.data.remote.dto.CreatePriceProposalRequest
import com.udem.retaildecision.data.remote.dto.PriceProposalDto
import com.udem.retaildecision.data.remote.mensajeDeError
import java.io.IOException

/** Propuestas de precio del Proveedor (pricing-service, /v1/price-proposals). */
class ProposalsRepository(
    private val api: PricingApi,
    /** Se llama cuando el servidor responde 401: la sesión ya no sirve y hay que volver al login. */
    private val onSesionExpirada: () -> Unit = {},
) {

    /** Las propuestas de mi empresa (el servidor ya recorta por dueño), de todas las páginas. */
    suspend fun propuestas(): Result<List<PriceProposalDto>> {
        return try {
            val todas = mutableListOf<PriceProposalDto>()
            var page = 1
            while (true) {
                val res = api.getProposals(page = page)
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
            Result.failure(Exception("No se pudieron leer tus propuestas."))
        }
    }

    suspend fun crear(presentationId: String, precio: Double, unidadCompra: String?): Result<PriceProposalDto> {
        return try {
            val res = api.createProposal(
                CreatePriceProposalRequest(
                    presentationId = presentationId,
                    proposedPrice = precio,
                    purchaseUnit = unidadCompra?.trim()?.ifEmpty { null },
                ),
            )
            if (res.code() == 401) onSesionExpirada()
            val body = res.body()
            if (res.isSuccessful && body != null) {
                Result.success(body)
            } else {
                Result.failure(Exception(mensajeDeError(res, mensajeHttp(res.code()))))
            }
        } catch (e: IOException) {
            Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudo enviar la propuesta."))
        }
    }

    private fun mensajeHttp(code: Int): String = when (code) {
        401 -> "Tu sesión expiró. Vuelve a iniciar sesión."
        403 -> "Tu cuenta no puede hacer propuestas de precio. Revisa que tu empresa esté activa y vinculada."
        409 -> "Ya tienes una propuesta pendiente para esa presentación, o el producto aún no está activo."
        else -> "El servidor respondió con error ($code)."
    }
}