package com.udem.retaildecision.data.remote

import com.udem.retaildecision.data.remote.dto.LoginRequest
import com.udem.retaildecision.data.remote.dto.LoginResponse
import com.udem.retaildecision.data.remote.dto.RefreshRequest
import com.udem.retaildecision.data.remote.dto.RefreshResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface AuthApi {
    @POST("v1/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    /** Pública, pero necesita un refreshToken vigente. */
    @POST("v1/auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): Response<RefreshResponse>

    /** Protegido con SessionGuard: el interceptor de ApiClient ya manda el access token. */
    @POST("v1/auth/logout")
    suspend fun logout(): Response<Unit>
}