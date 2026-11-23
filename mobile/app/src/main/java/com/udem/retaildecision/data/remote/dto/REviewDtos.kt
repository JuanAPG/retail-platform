package com.udem.retaildecision.data.remote.dto

/** Precio levantado en campo (pricing-service, /v1/price-observations). Los decimales llegan como texto. */
data class PriceObservationDto(
    val id: String,
    val presentationId: String,
    val storeId: String,
    val price: String,
    val observedAt: String,
    val lat: String? = null,
    val lng: String? = null,
    /** pendiente | aprobado | rechazado */
    val status: String,
    val origin: String? = null,
    val rejectionReason: String? = null,
    val capturedBy: String? = null,
    val createdAt: String? = null,
    val presentation: ObservationPresentationDto? = null,
    val store: ObservationStoreDto? = null,
)

data class ObservationPresentationDto(
    val id: String,
    val productoId: String? = null,
    val nombre: String,
    val producto: ObservationProductDto? = null,
)

data class ObservationProductDto(val sku: String, val nombre: String)

data class ObservationStoreDto(val id: String, val nombre: String, val zonaId: String? = null)

data class RejectPriceBody(val rejectionReason: String)

data class RejectProductBody(val motivoRechazo: String)

/** POST /v1/products/proposals (Proveedor). `proveedorId`, `estatus` y `esCanastaBasica` los fija el servidor: no se mandan. */
data class ProductProposalRequest(
    val sku: String,
    val nombre: String,
    val descripcion: String? = null,
    val categoriaId: Int,
    val presentacion: String,
    val contenido: Double,
    /** Clave de la unidad (kg, g, l, ml, pza…), no el id. */
    val unidadMedida: String,
)