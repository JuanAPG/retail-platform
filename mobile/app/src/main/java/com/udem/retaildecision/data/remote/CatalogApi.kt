package com.udem.retaildecision.data.remote

import com.udem.retaildecision.data.remote.dto.PageResponse
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.ZoneDto
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Query

interface CatalogApi {

    @GET("v1/products")
    suspend fun getProducts(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<PageResponse<ProductDto>>

    @GET("v1/zones")
    suspend fun getZones(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<PageResponse<ZoneDto>>
}