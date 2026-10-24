package com.udem.retaildecision.data.remote.dto

/** Dirección de una tienda. Latitud y longitud llegan como texto decimal ("25.686600") o vacías. */
data class StoreDireccionDto(
    val id: String? = null,
    val calle: String? = null,
    val numeroExterior: String? = null,
    val colonia: String? = null,
    val codigoPostal: String? = null,
    val latitud: String? = null,
    val longitud: String? = null,
)

data class StoreZonaDto(
    val id: String,
    val nombre: String,
)

/** Tienda o sucursal de catalog-service (GET /v1/stores). */
data class StoreDto(
    val id: String,
    val nombre: String,
    /** supermercado, minimarket, tienda_conveniencia, mayorista u otro. */
    val formato: String? = null,
    val numeroSucursal: String? = null,
    val activo: Boolean = true,
    val zonaId: String? = null,
    val direccion: StoreDireccionDto? = null,
    val zona: StoreZonaDto? = null,
)