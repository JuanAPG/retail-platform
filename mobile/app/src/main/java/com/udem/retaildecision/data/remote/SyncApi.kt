package com.udem.retaildecision.data.remote

import com.udem.retaildecision.data.remote.dto.AcuseLoteDto
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

/** offline-sync-service (3118). Contrato: docs/contratos/offline-sync-service.md. Solo JSON (móvil). */
interface SyncApi {

    /**
     * Manda un lote y recibe el acuse por captura. El cuerpo va como texto ya armado para que un
     * reenvío lleve exactamente los mismos bytes que el primer intento (mismo lote = mismo hash).
     * Roles: Investigador de mercado, Analista comercial, Responsable de precios.
     */
    @POST("v1/sync/batches")
    suspend fun enviarLote(
        @Body cuerpo: RequestBody,
        /** Uno nuevo por intento (contrato §2: "un reenvío trae su propio id de correlación"). */
        @Header("X-Correlation-Id") correlacion: String,
    ): Response<AcuseLoteDto>
}
