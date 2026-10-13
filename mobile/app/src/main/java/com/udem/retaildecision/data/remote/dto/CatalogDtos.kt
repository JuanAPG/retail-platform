package com.udem.retaildecision.data.remote.dto

/** Envoltura paginada que usa catalog-service: { data, total, page, limit }. */
data class PageResponse<T>(
    val data: List<T>,
    val total: Int,
    val page: Int,
    val limit: Int
)

data class CategoriaDto(
    val id: Int,
    val nombre: String,
    val categoriaPadreId: Int? = null,
    val descripcion: String? = null
)

data class ProveedorDto(
    val id: String,
    val razonSocial: String,
    val email: String? = null,
    val telefono: String? = null,
    val activo: Boolean = true
)

data class UnidadMedidaDto(
    val id: Int,
    val clave: String,
    val nombre: String,
    val tipo: String? = null
)

data class PresentacionDto(
    val id: String,
    val productoId: String,
    val nombre: String,
    /** Llega como texto ("300.000"), no como número. */
    val contenido: String,
    val codigoBarras: String? = null,
    val esPredeterminada: Boolean = false,
    val activo: Boolean = true,
    val unidadMedida: UnidadMedidaDto? = null
)

data class ProductDto(
    val id: String,
    val sku: String,
    val nombre: String,
    val descripcion: String? = null,
    val categoriaId: Int,
    val esCanastaBasica: Boolean = false,
    /** "activo" o "pendiente_aprobacion". */
    val estatus: String,
    val proveedorId: String? = null,
    val categoria: CategoriaDto? = null,
    val proveedor: ProveedorDto? = null,
    val presentaciones: List<PresentacionDto> = emptyList()
)

data class MunicipioDto(
    val id: Int,
    val nombre: String
)

data class ZoneDto(
    val id: String,
    val nombre: String,
    val municipioId: Int,
    val descripcion: String? = null,
    val activo: Boolean = true,
    val municipio: MunicipioDto? = null
)