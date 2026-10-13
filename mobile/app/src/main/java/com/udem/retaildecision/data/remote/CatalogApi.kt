package com.udem.retaildecision.data.remote

import com.udem.retaildecision.data.remote.dto.PageResponse
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.ZoneDto
import com.udem.retaildecision.data.remote.dto.CategoriaDto
import com.udem.retaildecision.data.remote.dto.ProductProposalRequest
import com.udem.retaildecision.data.remote.dto.RejectProductBody
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.remote.dto.UnidadMedidaDto
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface CatalogApi {

    @GET("v1/products")
    suspend fun getProducts(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<PageResponse<ProductDto>>

    /** Tiendas. Las pueden leer los 6 perfiles internos (el Proveedor no). */
    @GET("v1/stores")
    suspend fun getStores(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<PageResponse<StoreDto>>

    /** Catálogos planos, sin paginar. Los puede leer cualquier usuario autenticado. */
    @GET("v1/product-categories")
    suspend fun getCategories(): Response<List<CategoriaDto>>

    @GET("v1/units")
    suspend fun getUnits(): Response<List<UnidadMedidaDto>>

    /** Solo Proveedor. Nace `pendiente_aprobacion`. SKU repetido: 409. Cuenta sin empresa activa: 403. */
    @POST("v1/products/proposals")
    suspend fun createProductProposal(@Body body: ProductProposalRequest): Response<ProductDto>

    /** Bandeja de propuestas de producto por revisar. Gerente de categoría; Administrador y Auditor solo leen. */
    @GET("v1/products/pending")
    suspend fun getPendingProducts(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<PageResponse<ProductDto>>

    /** Solo Gerente de categoría. Ya resuelta por otro revisor: 409. */
    @PATCH("v1/products/{id}/approve")
    suspend fun approveProduct(@Path("id") id: String, @Body body: Map<String, String>): Response<Unit>

    /** Solo Gerente de categoría. `motivoRechazo` obligatorio, mínimo 10 caracteres. */
    @PATCH("v1/products/{id}/reject")
    suspend fun rejectProduct(@Path("id") id: String, @Body body: RejectProductBody): Response<Unit>

    @GET("v1/zones")
    suspend fun getZones(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<PageResponse<ZoneDto>>
}