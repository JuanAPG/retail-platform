package com.udem.retaildecision.data.remote

import com.udem.retaildecision.data.remote.dto.CompareZonesResponse
import com.udem.retaildecision.data.remote.dto.CreatePriceObservationRequest
import com.udem.retaildecision.data.remote.dto.CreatePriceProposalRequest
import com.udem.retaildecision.data.remote.dto.PageResponse
import com.udem.retaildecision.data.remote.dto.PriceHistoryDto
import com.udem.retaildecision.data.remote.dto.PriceObservationDto
import com.udem.retaildecision.data.remote.dto.PriceProposalDto
import com.udem.retaildecision.data.remote.dto.RejectPriceBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface PricingApi {

    @GET("v1/prices/history")
    suspend fun getHistory(
        @Query("productId") productId: String,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<PageResponse<PriceHistoryDto>>

    @GET("v1/prices/compare-zones")
    suspend fun compareZones(
        @Query("productId") productId: String
    ): Response<CompareZonesResponse>

    /** Propuestas de precio. Un Proveedor recibe solo las de su empresa. `status` es opcional. */
    @GET("v1/price-proposals")
    suspend fun getProposals(
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<PageResponse<PriceProposalDto>>

    /** Solo el rol Proveedor, y solo para presentaciones de productos de su empresa. */
    @POST("v1/price-proposals")
    suspend fun createProposal(@Body body: CreatePriceProposalRequest): Response<PriceProposalDto>

    /** Precio visto en tienda. Roles: Analista comercial y Responsable de precios. Responde 201 con la observación (trae su id). */
    @POST("v1/price-observations")
    suspend fun createObservation(@Body body: CreatePriceObservationRequest): Response<PriceObservationDto>

    /**
     * Precios levantados en campo. Responsable de precios, Administrador y Auditor ven todos;
     * el Analista comercial solo los suyos. `status`: pendiente | aprobado | rechazado.
     */
    @GET("v1/price-observations")
    suspend fun getObservations(
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<PageResponse<PriceObservationDto>>

    /** Solo Responsable de precios (D1). Cuerpo opcional `{effectiveDate}`; se manda vacío = hoy. */
    @PATCH("v1/price-observations/{id}/approve")
    suspend fun approveObservation(@Path("id") id: String, @Body body: Map<String, String>): Response<Unit>

    /** Solo Responsable de precios. `rejectionReason` obligatorio, mínimo 10 caracteres. */
    @PATCH("v1/price-observations/{id}/reject")
    suspend fun rejectObservation(@Path("id") id: String, @Body body: RejectPriceBody): Response<Unit>
}