package com.udem.retaildecision.data.remote

import com.google.gson.Gson
import com.udem.retaildecision.BuildConfig
import com.udem.retaildecision.data.local.TokenManager
import com.udem.retaildecision.data.remote.dto.RefreshRequest
import com.udem.retaildecision.data.remote.dto.RefreshResponse
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/**
 * Punto único de construcción de Retrofit (singleton).
 *
 * - `authInterceptor` agrega `Authorization: Bearer <access>` a cada petición.
 * - `tokenAuthenticator` se ejecuta cuando el servidor responde 401: renueva
 *   el par de tokens con /v1/auth/refresh y reintenta la petición original.
 * - Si la renovación es rechazada (la sesión ya no existe en el servidor),
 *   se borra la sesión local y se emite `sessionExpired` para que la app
 *   regrese al login.
 */
object ApiClient {

    private lateinit var tokenManager: TokenManager
    private val gson = Gson()

    /** Se emite cuando la sesión murió de verdad y hay que volver a iniciar sesión. */
    private val _sessionExpired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sessionExpired: SharedFlow<Unit> = _sessionExpired.asSharedFlow()

    fun init(tokenManager: TokenManager) {
        this.tokenManager = tokenManager
    }

    private val acceptJsonInterceptor = Interceptor { chain ->
        val request = chain.request().newBuilder()
            .addHeader("Accept", "application/json")
            .build()
        chain.proceed(request)
    }

    private val authInterceptor = Interceptor { chain ->
        val token = tokenManager.getAccessToken()
        val request = if (token != null) {
            chain.request().newBuilder().addHeader("Authorization", "Bearer $token").build()
        } else {
            chain.request()
        }
        chain.proceed(request)
    }

    /** Cliente "pelón", sin authInterceptor ni authenticator, solo para el refresh en sí. */
    private val rawClientForRefresh = OkHttpClient.Builder()
        .addInterceptor(acceptJsonInterceptor)
        .build()

    private val tokenAuthenticator = Authenticator { _: Route?, response -> renovar(response) }

    /**
     * @Synchronized: si dos peticiones fallan con 401 a la vez, la segunda espera a que la
     * primera termine. Como el servidor rota el refresh token, renovar dos veces en paralelo
     * haría fallar a la segunda y cerraría la sesión sin necesidad.
     */
    @Synchronized
    private fun renovar(response: okhttp3.Response): Request? {
        // Sin refresh token no hubo sesión (por ejemplo, un login con contraseña incorrecta): nada que renovar.
        val refreshToken = tokenManager.getRefreshToken() ?: return null

        // Ya se reintentó una vez y sigue dando 401: la sesión no sirve.
        if (responseCount(response) >= 2) {
            cerrarSesion()
            return null
        }

        // Otra petición ya renovó los tokens mientras esta esperaba: basta reintentar con el nuevo.
        val usado = response.request.header("Authorization")?.removePrefix("Bearer ")
        val actual = tokenManager.getAccessToken()
        if (actual != null && usado != null && usado != actual) {
            return response.request.newBuilder().header("Authorization", "Bearer $actual").build()
        }

        val requestBody = gson.toJson(RefreshRequest(refreshToken))
            .toRequestBody("application/json".toMediaType())
        val refreshRequest = Request.Builder()
            .url(BuildConfig.API_BASE_URL + "v1/auth/refresh")
            .post(requestBody)
            .build()

        rawClientForRefresh.newCall(refreshRequest).execute().use {
            if (!it.isSuccessful) {
                // 4xx = el servidor rechazó el refresh token (sesión revocada o vencida). 5xx = falla del servidor: no cerrar.
                if (it.code in 400..499) cerrarSesion()
                return null
            }
            val body = it.body?.string() ?: return null
            val parsed = runCatching { gson.fromJson(body, RefreshResponse::class.java) }.getOrNull()
                ?: return null

            tokenManager.updateTokens(parsed.accessToken, parsed.refreshToken)

            return response.request.newBuilder()
                .header("Authorization", "Bearer ${parsed.accessToken}")
                .build()
        }
    }

    private fun cerrarSesion() {
        tokenManager.clearSession()
        _sessionExpired.tryEmit(Unit)
    }

    /** Para quien detecte que la sesión ya no sirve (por ejemplo, un 401 que llegó hasta la pantalla). */
    fun expirarSesion() = cerrarSesion()

    private fun responseCount(response: okhttp3.Response): Int {
        var result = 1
        var prior = response.priorResponse
        while (prior != null) {
            result++
            prior = prior.priorResponse
        }
        return result
    }

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY else HttpLoggingInterceptor.Level.NONE
    }

    private val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .addInterceptor(acceptJsonInterceptor)
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .authenticator(tokenAuthenticator)
            .build()
    }

    private val retrofit: Retrofit by lazy {
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    /** Mismo cliente HTTP, con la URL de pricing-service. */
    private val pricingRetrofit: Retrofit by lazy {
        Retrofit.Builder()
            .baseUrl(BuildConfig.PRICING_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    /** Mismo cliente HTTP (token, Accept JSON, renovación por 401), pero con la URL de catalog-service. */
    private val catalogRetrofit: Retrofit by lazy {
        Retrofit.Builder()
            .baseUrl(BuildConfig.CATALOG_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    val authApi: AuthApi by lazy { retrofit.create(AuthApi::class.java) }
    val catalogApi: CatalogApi by lazy { catalogRetrofit.create(CatalogApi::class.java) }
    val pricingApi: PricingApi by lazy { pricingRetrofit.create(PricingApi::class.java) }
}