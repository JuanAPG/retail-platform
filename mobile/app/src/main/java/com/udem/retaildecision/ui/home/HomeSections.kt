package com.udem.retaildecision.ui.home

import com.udem.retaildecision.data.model.Rol
import com.udem.retaildecision.data.model.TipoCaptura

/*
 * Menú por rol. Fuente: docs/matriz-perfiles-permisos.md (§3) y los contratos de cada servicio.
 * El servidor es quien manda (responde 403 a un rol sin permiso); esto solo decide qué se le ofrece a cada quien.
 *
 * Investigador de mercado (D-28): lee productos, presentaciones, tiendas y zonas, y captura precios
 * observados y disponibilidad. No ve historial de precios, comparación ni nada más (Matriz §3, nota 6).
 *
 * Fuera del menú a propósito (PENDIENTE en el contrato de offline-sync-service §6, no entra en la versión 1.0):
 *  - Visitas de campo: ubicación de la visita y respuestas de encuesta (D-30).
 *  - Propuesta de producto desde campo cuando el código de barras no existe (D-32).
 */

/**
 * POST /v1/sync/batches (offline-sync-service, contrato §2): Investigador de mercado, Analista comercial
 * y Responsable de precios. Qué TIPO de captura puede mandar cada uno lo decide `TipoCaptura.permitidosPara`.
 * El Planeador queda fuera: el contrato le responde 403 (no puede dar de alta ningún tipo).
 */
private val ROLES_CAPTURA = TipoCaptura.ROLES_QUE_SINCRONIZAN

/** PATCH /v1/price-observations/:id/approve|reject: solo el Responsable de precios (D1); Admin y Auditor leen la cola. */
private val ROLES_VEN_COLA_PRECIOS = setOf(Rol.RESPONSABLE_PRECIOS, Rol.ADMINISTRADOR, Rol.AUDITOR)

/** PATCH /v1/products/:id/approve|reject: solo el Gerente de categoría (D-08); Admin y Auditor leen la bandeja. */
private val ROLES_VEN_COLA_PRODUCTOS = setOf(Rol.GERENTE_CATEGORIA, Rol.ADMINISTRADOR, Rol.AUDITOR)

/**
 * GET /v1/prices/history (pricing-service): los 6 perfiles internos. El Investigador no (Matriz §3 M08: solo
 * propone precios observados), así que el escáner no le muestra precios.
 */
val ROLES_VEN_PRECIOS = Rol.INTERNOS

/** GET /v1/price-observations (pricing): el Analista ve las suyas y el Responsable todas. Al Investigador le da 403. */
val ROLES_CONSULTAN_DECISIONES = setOf(Rol.ANALISTA, Rol.RESPONSABLE_PRECIOS)

data class SeccionMovil(
    val id: String,
    val titulo: String,
    val descripcion: String,
    /** Microservicio que alimenta la sección (se muestra para saber qué se consume). */
    val servicio: String,
    val roles: Set<String>,
    /** Descripción distinta para algún rol (por ejemplo, lo que el Investigador no ve). Si no está, `descripcion`. */
    val descripcionPorRol: Map<String, String> = emptyMap(),
)

val SECCIONES = listOf(
    SeccionMovil(
        id = "catalogo",
        titulo = "Catálogo de productos",
        descripcion = "Consulta productos y presentaciones.",
        servicio = "catalog-service",
        // GET /v1/products: los 8 perfiles (el Proveedor ve solo los suyos; el Investigador solo los activos)
        roles = Rol.INTERNOS + Rol.PROVEEDOR + Rol.INVESTIGADOR,
    ),
    SeccionMovil(
        id = "escaner",
        titulo = "Escanear código de barras",
        descripcion = "Identifica un producto con la cámara.",
        servicio = "catalog-service",
        roles = Rol.INTERNOS + Rol.INVESTIGADOR,
    ),
    SeccionMovil(
        id = "zonas",
        titulo = "Zonas",
        descripcion = "Consulta las zonas y su clasificación de ingreso.",
        servicio = "catalog-service",
        roles = Rol.INTERNOS + Rol.INVESTIGADOR, // GET /v1/zones: 6 internos + Investigador (D-28)
        // El Investigador no ve el nivel de ingreso (income-segmentation le responde 403, D-28).
        descripcionPorRol = mapOf(Rol.INVESTIGADOR to "Consulta las zonas y sus tiendas."),
    ),
    SeccionMovil(
        id = "precios",
        titulo = "Historial de precios",
        descripcion = "Consulta cómo han cambiado los precios.",
        servicio = "pricing-service",
        roles = ROLES_VEN_PRECIOS,
    ),
    SeccionMovil(
        id = "visitas", // id interno que se conserva para no tocar los iconos; el texto visible es otro
        titulo = "Capturas en tienda",
        descripcion = "Levanta precios y existencias con tu ubicación, incluso sin conexión.",
        servicio = "offline-sync-service",
        roles = ROLES_CAPTURA,
    ),
    SeccionMovil(
        id = "revision_precios",
        titulo = "Precios de campo por revisar",
        descripcion = "Aprueba o rechaza los precios levantados en tienda.",
        servicio = "pricing-service",
        roles = ROLES_VEN_COLA_PRECIOS,
    ),
    SeccionMovil(
        id = "productos_pendientes",
        titulo = "Productos por aprobar",
        descripcion = "Revisa los productos que proponen los Proveedores.",
        servicio = "catalog-service",
        roles = ROLES_VEN_COLA_PRODUCTOS,
    ),
    SeccionMovil(
        id = "comparar_precios",
        titulo = "Comparar mis precios",
        descripcion = "Mira cómo se venden tus productos por zona y por unidad.",
        servicio = "pricing-service",
        roles = setOf(Rol.PROVEEDOR), // GET /v1/prices/compare-zones: el Proveedor solo de productos suyos
    ),
    SeccionMovil(
        id = "proponer_producto",
        titulo = "Proponer un producto",
        descripcion = "Da de alta un producto nuevo; el Gerente de categoría lo revisa.",
        servicio = "catalog-service",
        roles = setOf(Rol.PROVEEDOR), // POST /v1/products/proposals: solo Proveedor (D-32 sigue PENDIENTE para campo)
    ),
    SeccionMovil(
        id = "propuestas",
        titulo = "Mis propuestas de precio",
        descripcion = "Envía y consulta tus propuestas de precio.",
        servicio = "pricing-service",
        roles = setOf(Rol.PROVEEDOR), // /v1/price-proposals: crear y ver las propias, solo Proveedor
    ),
)

/** Secciones que ve un rol, con la descripción que le toca. Lista vacía si el rol no existe o no tiene acceso. */
fun seccionesParaRol(rol: String?): List<SeccionMovil> =
    if (rol == null) emptyList()
    else SECCIONES.filter { rol in it.roles }.map { s -> s.descripcionPorRol[rol]?.let { s.copy(descripcion = it) } ?: s }
