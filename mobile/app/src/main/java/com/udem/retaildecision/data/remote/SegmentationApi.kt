package com.udem.retaildecision.data.remote

import com.udem.retaildecision.data.remote.dto.PageResponse
import com.udem.retaildecision.data.remote.dto.ZoneClassificationDto
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * income-segmentation-service (contrato: docs/contratos/income-segmentation-service.md).
 * Solo los 6 perfiles internos; al Proveedor y al Investigador de mercado les responde 403 (D-28),
 * así que la app ni siquiera se lo pide a ellos.
 */
interface SegmentationApi {

    /** Clasificaciones; con `current=true`, solo la vigente de cada zona. Paginado (limit ≤ 100). */
    @GET("v1/zone-classifications")
    suspend fun getZoneClassifications(
        @Query("current") current: Boolean = true,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<PageResponse<ZoneClassificationDto>>

    /** Clasificación vigente de una zona. Sin clasificación vigente → 404. */
    @GET("v1/zones/{zoneId}/classification")
    suspend fun getZoneClassification(@Path("zoneId") zoneId: String): Response<ZoneClassificationDto>
}
