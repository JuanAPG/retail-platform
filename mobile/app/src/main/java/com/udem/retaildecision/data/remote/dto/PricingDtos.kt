package com.udem.retaildecision.data.remote.dto

data class PricePresentationDto(
    val id: String,
    val productoId: String,
    val nombre: String,
    val contenido: String,
    val unidadMedida: String? = null
)

data class PriceZoneRefDto(
    val id: String,
    val nombre: String
)

data class PriceStoreDto(
    val id: String,
    val nombre: String,
    val zonaId: String? = null,
    val zona: PriceZoneRefDto? = null
)

/** Un precio de una presentación en una tienda. `price` llega como texto ("24.00"). */
data class PriceHistoryDto(
    val id: String,
    val presentationId: String,
    val storeId: String,
    val price: String,
    val effectiveDate: String,
    val effectiveUntil: String? = null,
    val vigente: Boolean = false,
    val origen: String? = null,
    val presentation: PricePresentationDto? = null,
    val store: PriceStoreDto? = null
)

/** Resumen de precios de un producto en una zona. */
data class ZoneComparisonDto(
    val zoneId: String,
    val zoneName: String,
    val averagePrice: Double,
    val minPrice: Double,
    val maxPrice: Double,
    val storeCount: Int
)

data class CompareZonesResponse(
    val productId: String,
    val zones: List<ZoneComparisonDto> = emptyList()
)