package com.udem.retaildecision.data.model

/**
 * Nombres de rol EXACTOS, igual que la tabla `roles` y que `ROL` en el archivo roles.ts de cada servicio.
 * Fuente de verdad: docs/matriz-perfiles-permisos.md (§1). Si ahí cambia un rol, aquí también.
 *
 * "Investigador de mercado" NO está aquí a propósito: es el pendiente P-01 y todavía no existe en el servidor.
 */
object Rol {
    const val ADMINISTRADOR = "Administrador"
    const val ANALISTA = "Analista comercial"
    const val GERENTE_CATEGORIA = "Gerente de categoría"
    const val RESPONSABLE_PRECIOS = "Responsable de precios"
    const val PLANEADOR = "Planeador"
    const val AUDITOR = "Auditor"
    const val PROVEEDOR = "Proveedor"

    /** Los seis perfiles internos (el Proveedor es externo). */
    val INTERNOS = setOf(ADMINISTRADOR, ANALISTA, GERENTE_CATEGORIA, RESPONSABLE_PRECIOS, PLANEADOR, AUDITOR)
}