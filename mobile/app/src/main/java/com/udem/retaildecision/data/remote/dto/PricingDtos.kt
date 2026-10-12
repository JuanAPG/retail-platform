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

/**
 * Resumen de precios de un producto en una zona, POR PRESENTACIÓN (una fila por zona y presentación).
 * Los dos campos de presentación son nuevos en el contrato; se dejan opcionales por si el servidor
 * es una versión anterior.
 */
data class ZoneComparisonDto(
    val zoneId: String,
    val zoneName: String,
    val presentationId: String? = null,
    val presentationName: String? = null,
    val averagePrice: Double,
    val minPrice: Double,
    val maxPrice: Double,
    val storeCount: Int
)

/** Precio normalizado por unidad base (kg, l, pza) en una zona: sirve para comparar tamaños distintos. */
data class PerUnitComparisonDto(
    val zoneId: String,
    val zoneName: String,
    val baseUnit: String,
    val averagePricePerBaseUnit: Double,
    val minPricePerBaseUnit: Double,
    val maxPricePerBaseUnit: Double,
    val storeCount: Int
)

data class CompareZonesResponse(
    val productId: String,
    val zones: List<ZoneComparisonDto> = emptyList(),
    val perUnit: List<PerUnitComparisonDto>? = null
)

// ---------------------------------------------------------------------------------------------
// Propuestas de precio del Proveedor: /v1/price-proposals
// ---------------------------------------------------------------------------------------------

data class ProposalProductDto(
    val sku: String? = null,
    val nombre: String? = null
)

data class ProposalPresentationDto(
    val id: String,
    val nombre: String,
    val contenido: String? = null,
    val unidadMedida: String? = null,
    val producto: ProposalProductDto? = null
)

/** `status`: pendiente | aprobado | rechazado. `proposedPrice` llega como texto ("38.00"). */
data class PriceProposalDto(
    val id: String,
    val presentationId: String,
    val proposedPrice: String,
    val purchaseUnit: String? = null,
    val status: String,
    val rejectionReason: String? = null,
    val createdAt: String? = null,
    val presentation: ProposalPresentationDto? = null
)

/** Body de POST /v1/price-proposals. El servidor rechaza cualquier campo que no esté aquí. */
data class CreatePriceProposalRequest(
    val presentationId: String,
    val proposedPrice: Double,
    val purchaseUnit: String? = null
)

// ---------------------------------------------------------------------------------------------
// Precio observado en tienda (app móvil, D-16): /v1/price-observations
// ---------------------------------------------------------------------------------------------

/**
 * Body de POST /v1/price-observations. `lat` y `lng` van juntas. El autor y el estado los pone el
 * servidor: la observación nace "pendiente" hasta que el Responsable de precios la aprueba.
 */
data class CreatePriceObservationRequest(
    val presentationId: String,
    val storeId: String,
    val price: Double,
    val observedAt: String? = null,
    val lat: Double? = null,
    val lng: Double? = null
)