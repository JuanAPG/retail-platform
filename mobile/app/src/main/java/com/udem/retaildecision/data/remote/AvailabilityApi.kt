package com.udem.retaildecision.data.remote

import com.udem.retaildecision.data.remote.dto.ZoneCoverageDto
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Path

/**
 * availability-service (contrato: docs/contratos/availability-service.md). Las lecturas son de los 6
 * perfiles internos; el Investigador solo da de alta capturas (D-28) y en lecturas recibe 403.
 */
interface AvailabilityApi {

    /** Cobertura de básicos de la zona (D-38). `disponible: false` llega sin `coverage`: nunca es 0. */
    @GET("v1/availability/zones/{zoneId}/coverage")
    suspend fun getZoneCoverage(@Path("zoneId") zoneId: String): Response<ZoneCoverageDto>
}
