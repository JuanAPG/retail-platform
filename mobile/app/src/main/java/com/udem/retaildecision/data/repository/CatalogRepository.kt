package com.udem.retaildecision.data.repository

import com.udem.retaildecision.data.remote.CatalogApi
import com.udem.retaildecision.data.remote.dto.PageResponse
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.ZoneDto
import retrofit2.Response
import java.io.IOException

/**
 * Pide el catálogo al servidor. El servicio entrega los datos por páginas;
 * aquí se piden todas las páginas y se regresa una sola lista, o un error
 * con un mensaje que el usuario pueda entender.
 */
class CatalogRepository(
    private val api: CatalogApi,
    /** Se llama cuando el servidor responde 401: la sesión ya no sirve y hay que volver al login. */
    private val onSesionExpirada: () -> Unit = {},
) {

    suspend fun productos(): Result<List<ProductDto>> = cargarTodo { page -> api.getProducts(page = page) }

    suspend fun zonas(): Result<List<ZoneDto>> = cargarTodo { page -> api.getZones(page = page) }

    private suspend fun <T> cargarTodo(
        pedir: suspend (Int) -> Response<PageResponse<T>>,
    ): Result<List<T>> {
        return try {
            val todos = mutableListOf<T>()
            var page = 1
            while (true) {
                val res = pedir(page)
                if (res.code() == 401) onSesionExpirada()
                if (!res.isSuccessful) return Result.failure(Exception(mensajeHttp(res.code())))
                val body = res.body() ?: return Result.failure(Exception("El servidor respondió sin datos."))
                todos += body.data
                // Se detiene al tener todo (total) o si una página llega vacía.
                if (todos.size >= body.total || body.data.isEmpty()) break
                page++
            }
            Result.success(todos)
        } catch (e: IOException) {
            Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudo leer el catálogo."))
        }
    }

    private fun mensajeHttp(code: Int): String = when (code) {
        401 -> "Tu sesión expiró. Vuelve a iniciar sesión."
        403 -> "Tu rol no tiene permiso para ver esta información."
        else -> "El servidor respondió con error ($code)."
    }
}