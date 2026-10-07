package com.udem.retaildecision.data.remote

import com.udem.retaildecision.data.remote.dto.CompareZonesResponse
import com.udem.retaildecision.data.remote.dto.PageResponse
import com.udem.retaildecision.data.remote.dto.PriceHistoryDto
import retrofit2.Response
import retrofit2.http.GET
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
}