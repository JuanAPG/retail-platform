package com.udem.retaildecision.ui.home

private val ROLES_INTERNOS = setOf(
    "Administrador",
    "Analista comercial",
    "Gerente de categoría",
    "Responsable de precios",
    "Planeador",
    "Auditor",
)
private const val PROVEEDOR = "Proveedor"

data class SeccionMovil(
    val id: String,
    val titulo: String,
    val descripcion: String,
    /** Microservicio que alimenta la sección (se muestra para saber qué se consume). */
    val servicio: String,
    val roles: Set<String>,
)

val SECCIONES = listOf(
    SeccionMovil(
        id = "catalogo",
        titulo = "Catálogo de productos",
        descripcion = "Consulta productos y presentaciones.",
        servicio = "catalog-service",
        roles = ROLES_INTERNOS + PROVEEDOR, // GET /v1/products: los 7 perfiles (el Proveedor ve solo los suyos)
    ),
    SeccionMovil(
        id = "escaner",
        titulo = "Escanear código de barras",
        descripcion = "Identifica un producto con la cámara.",
        servicio = "catalog-service",
        roles = ROLES_INTERNOS,
    ),
    SeccionMovil(
        id = "zonas",
        titulo = "Zonas",
        descripcion = "Consulta las zonas y su clasificación de ingreso.",
        servicio = "catalog-service",
        roles = ROLES_INTERNOS,
    ),
    SeccionMovil(
        id = "precios",
        titulo = "Historial de precios",
        descripcion = "Consulta cómo han cambiado los precios.",
        servicio = "pricing-service",
        roles = ROLES_INTERNOS, // GET /v1/prices/history: los 6 internos
    ),
    SeccionMovil(
        id = "propuestas",
        titulo = "Mis propuestas de precio",
        descripcion = "Envía y consulta tus propuestas de precio.",
        servicio = "pricing-service",
        roles = setOf(PROVEEDOR), // POST /v1/price-proposals: solo Proveedor
    ),
    SeccionMovil(
        id = "visitas",
        titulo = "Registrar visita",
        descripcion = "Registra una visita a tienda, incluso sin conexión.",
        servicio = "core-process-service",
        roles = ROLES_INTERNOS, // supuesto: pendiente del contrato de core-process-service
    ),
)

/** Secciones que ve un rol. Lista vacía si el rol no existe o no tiene acceso. */
fun seccionesParaRol(rol: String?): List<SeccionMovil> =
    if (rol == null) emptyList() else SECCIONES.filter { rol in it.roles }