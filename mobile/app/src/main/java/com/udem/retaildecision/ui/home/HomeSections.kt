package com.udem.retaildecision.ui.home

import com.udem.retaildecision.data.model.Rol

/*
 * Menú por rol. Fuente: docs/matriz-perfiles-permisos.md (§3) y los contratos de cada servicio.
 * El servidor es quien manda (responde 403 a un rol sin permiso); esto solo decide qué se le ofrece a cada quien.
 *
 * Fuera del menú a propósito (la matriz no lo ha decidido, hay que reportarlo y no asumirlo):
 *  - "Investigador de mercado" (P-01): el rol no existe en el servidor. Capturan precios en campo los dos
 *    roles que hoy acepta POST /v1/price-observations.
 *  - Disponibilidad, encuestas y ubicación (RF-36 a RF-38, P-03): no hay servicio que las guarde.
 *  - Código de barras no encontrado (P-08).
 */

/** POST /v1/price-observations (pricing-service): hoy solo estos dos roles capturan precios en campo. */
private val ROLES_CAPTURA = setOf(Rol.ANALISTA, Rol.RESPONSABLE_PRECIOS)

/** PATCH /v1/price-observations/:id/approve|reject: solo el Responsable de precios (D1); Admin y Auditor leen la cola. */
private val ROLES_VEN_COLA_PRECIOS = setOf(Rol.RESPONSABLE_PRECIOS, Rol.ADMINISTRADOR, Rol.AUDITOR)

/** PATCH /v1/products/:id/approve|reject: solo el Gerente de categoría (D-08); Admin y Auditor leen la bandeja. */
private val ROLES_VEN_COLA_PRODUCTOS = setOf(Rol.GERENTE_CATEGORIA, Rol.ADMINISTRADOR, Rol.AUDITOR)

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
        roles = Rol.INTERNOS + Rol.PROVEEDOR, // GET /v1/products: los 7 perfiles (el Proveedor ve solo los suyos)
    ),
    SeccionMovil(
        id = "escaner",
        titulo = "Escanear código de barras",
        descripcion = "Identifica un producto con la cámara.",
        servicio = "catalog-service",
        roles = Rol.INTERNOS,
    ),
    SeccionMovil(
        id = "zonas",
        titulo = "Zonas",
        descripcion = "Consulta las zonas y su clasificación de ingreso.",
        servicio = "catalog-service",
        roles = Rol.INTERNOS,
    ),
    SeccionMovil(
        id = "precios",
        titulo = "Historial de precios",
        descripcion = "Consulta cómo han cambiado los precios.",
        servicio = "pricing-service",
        roles = Rol.INTERNOS, // GET /v1/prices/history: los 6 internos
    ),
    SeccionMovil(
        id = "visitas", // id interno que se conserva para no tocar los iconos; el texto visible es otro
        titulo = "Levantar precio en tienda",
        descripcion = "Captura el precio de un producto con tu ubicación, incluso sin conexión.",
        servicio = "pricing-service",
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
        roles = setOf(Rol.PROVEEDOR), // POST /v1/products/proposals: solo Proveedor
    ),
    SeccionMovil(
        id = "propuestas",
        titulo = "Mis propuestas de precio",
        descripcion = "Envía y consulta tus propuestas de precio.",
        servicio = "pricing-service",
        roles = setOf(Rol.PROVEEDOR), // /v1/price-proposals: crear y ver las propias, solo Proveedor
    ),
)

/** Secciones que ve un rol. Lista vacía si el rol no existe o no tiene acceso. */
fun seccionesParaRol(rol: String?): List<SeccionMovil> =
    if (rol == null) emptyList() else SECCIONES.filter { rol in it.roles }