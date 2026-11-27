package com.udem.retaildecision.data.remote.dto

/** Clasificación de una zona por nivel de ingreso (income-segmentation-service, objeto ZoneClassification). */
data class ZoneClassificationDto(
    val id: String,
    val zoneId: String,
    val segmentId: Int? = null,
    /** ING_1, ING_2, ING_3…: no cambia entre versiones del segmento. */
    val segmentCode: String? = null,
    /** Nombre en la versión con la que se clasificó ("Ingreso bajo"). */
    val segmentName: String? = null,
    val segmentVersion: Int? = null,
    val validFrom: String? = null,
    val validTo: String? = null,
    val current: Boolean = true,
)

/** Cobertura de básicos de una zona (availability-service, GET /v1/availability/zones/:zoneId/coverage). */
data class ZoneCoverageDto(
    val zoneId: String,
    val validDays: Int? = null,
    /** Tiendas activas de la zona. */
    val stores: Int? = null,
    val basics: Int? = null,
    val covered: Int? = null,
    val disponible: Boolean = false,
    /** % de básicos cubiertos, 2 decimales. Ausente cuando `disponible` es false. */
    val coverage: Double? = null,
    val motivo: String? = null,
)
