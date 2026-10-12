package com.udem.retaildecision.data.repository

import com.udem.retaildecision.data.remote.CatalogApi
import com.udem.retaildecision.data.remote.dto.CategoriaDto
import com.udem.retaildecision.data.remote.dto.PageResponse
import com.udem.retaildecision.data.remote.dto.ProductProposalRequest
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.remote.dto.UnidadMedidaDto
import com.udem.retaildecision.data.remote.dto.RejectProductBody
import com.udem.retaildecision.data.remote.mensajeDeError
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

    suspend fun tiendas(): Result<List<StoreDto>> = cargarTodo { page -> api.getStores(page = page) }

    suspend fun categorias(): Result<List<CategoriaDto>> = listaPlana("las categorías") { api.getCategories() }

    suspend fun unidades(): Result<List<UnidadMedidaDto>> = listaPlana("las unidades") { api.getUnits() }

    private suspend fun <T> listaPlana(que: String, pedir: suspend () -> Response<List<T>>): Result<List<T>> {
        return try {
            val res = pedir()
            if (res.code() == 401) onSesionExpirada()
            val body = res.body()
            if (res.isSuccessful && body != null) Result.success(body)
            else Result.failure(Exception(mensajeHttp(res.code())))
        } catch (e: IOException) {
            Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudieron leer $que."))
        }
    }

    /** El Proveedor propone un producto nuevo; queda pendiente hasta que el Gerente de categoría lo resuelva. */
    suspend fun proponerProducto(solicitud: ProductProposalRequest): Result<ProductDto> {
        return try {
            val res = api.createProductProposal(solicitud)
            if (res.code() == 401) onSesionExpirada()
            val body = res.body()
            if (res.isSuccessful && body != null) {
                Result.success(body)
            } else {
                val porDefecto = when (res.code()) {
                    401 -> "Tu sesión expiró. Vuelve a iniciar sesión."
                    403 -> "Tu cuenta no puede proponer productos. Revisa que tu empresa esté activa y vinculada."
                    409 -> "Ese SKU ya existe. Usa uno distinto."
                    else -> "El servidor respondió con error (${res.code()})."
                }
                Result.failure(Exception(mensajeDeError(res, porDefecto)))
            }
        } catch (e: IOException) {
            Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudo enviar la propuesta."))
        }
    }

    /** Propuestas de producto pendientes de revisión (D-08), la más antigua primero. */
    suspend fun productosPendientes(): Result<List<ProductDto>> = cargarTodo { page -> api.getPendingProducts(page = page) }

    suspend fun aprobarProducto(id: String): Result<Unit> = resolver {
        api.approveProduct(id, emptyMap())
    }

    suspend fun rechazarProducto(id: String, motivo: String): Result<Unit> = resolver {
        api.rejectProduct(id, RejectProductBody(motivo.trim()))
    }

    private suspend fun resolver(llamada: suspend () -> Response<Unit>): Result<Unit> {
        return try {
            val res = llamada()
            if (res.code() == 401) onSesionExpirada()
            if (res.isSuccessful) {
                Result.success(Unit)
            } else {
                val porDefecto = when (res.code()) {
                    401 -> "Tu sesión expiró. Vuelve a iniciar sesión."
                    403 -> "Solo el Gerente de categoría puede aprobar o rechazar productos."
                    404 -> "Ese producto ya no existe."
                    409 -> "Otro revisor ya resolvió esta propuesta. Actualiza la lista."
                    else -> "El servidor respondió con error (${res.code()})."
                }
                Result.failure(Exception(mensajeDeError(res, porDefecto)))
            }
        } catch (e: IOException) {
            Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudo completar la acción."))
        }
    }

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