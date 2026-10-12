package com.udem.retaildecision.data.repository

import com.udem.retaildecision.data.remote.PricingApi
import com.udem.retaildecision.data.remote.dto.PerUnitComparisonDto
import com.udem.retaildecision.data.remote.dto.PriceHistoryDto
import com.udem.retaildecision.data.remote.dto.ZoneComparisonDto
import java.io.IOException

/** Todo lo que se muestra de un producto: su historial de precios y la comparación por zona. */
data class PrecioProducto(
    val historial: List<PriceHistoryDto>,
    /** Una fila por zona y presentación. */
    val zonas: List<ZoneComparisonDto>,
    /** Precio por unidad base (kg, l, pza) por zona: compara tamaños distintos. */
    val porUnidad: List<PerUnitComparisonDto> = emptyList(),
)

class PricingRepository(
    private val api: PricingApi,
    /** Se llama cuando el servidor responde 401: la sesión ya no sirve y hay que volver al login. */
    private val onSesionExpirada: () -> Unit = {},
) {

    /**
     * Solo la comparación por zona y por unidad, sin historial. Es lo único que el servidor deja ver
     * al Proveedor (y solo de sus productos): el historial es de los 6 perfiles internos.
     */
    suspend fun cargarComparacion(productId: String): Result<PrecioProducto> {
        return try {
            val comparacion = api.compareZones(productId)
            if (comparacion.code() == 401) onSesionExpirada()
            if (!comparacion.isSuccessful) return Result.failure(Exception(mensajeHttp(comparacion.code())))
            val cuerpo = comparacion.body()
            Result.success(
                PrecioProducto(
                    historial = emptyList(),
                    zonas = cuerpo?.zones ?: emptyList(),
                    porUnidad = cuerpo?.perUnit ?: emptyList(),
                ),
            )
        } catch (e: IOException) {
            Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudo leer la comparación de precios."))
        }
    }

    suspend fun cargar(productId: String): Result<PrecioProducto> {
        return try {
            val historial = mutableListOf<PriceHistoryDto>()
            var page = 1
            while (true) {
                val res = api.getHistory(productId, page)
                if (res.code() == 401) onSesionExpirada()
                if (!res.isSuccessful) return Result.failure(Exception(mensajeHttp(res.code())))
                val body = res.body() ?: return Result.failure(Exception("El servidor respondió sin datos."))
                historial += body.data
                if (historial.size >= body.total || body.data.isEmpty()) break
                page++
            }

            val comparacion = api.compareZones(productId)
            if (comparacion.code() == 401) onSesionExpirada()
            if (!comparacion.isSuccessful) return Result.failure(Exception(mensajeHttp(comparacion.code())))
            val cuerpo = comparacion.body()

            Result.success(
                PrecioProducto(
                    // Primero los precios vigentes y, dentro de cada grupo, los más recientes.
                    historial = historial.sortedWith(
                        compareByDescending<PriceHistoryDto> { it.vigente }.thenByDescending { it.effectiveDate },
                    ),
                    zonas = cuerpo?.zones ?: emptyList(),
                    porUnidad = cuerpo?.perUnit ?: emptyList(),
                ),
            )
        } catch (e: IOException) {
            Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudieron leer los precios."))
        }
    }

    private fun mensajeHttp(code: Int): String = when (code) {
        401 -> "Tu sesión expiró. Vuelve a iniciar sesión."
        403 -> "Tu rol no tiene permiso para ver los precios."
        404 -> "Ese producto ya no existe en el catálogo."
        else -> "El servidor respondió con error ($code)."
    }
}