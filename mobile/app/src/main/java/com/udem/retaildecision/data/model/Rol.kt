package com.udem.retaildecision.data.model

/**
 * Nombres de rol EXACTOS, igual que la tabla `roles` y que `ROL` en el archivo roles.ts de cada servicio.
 * Fuente de verdad: docs/matriz-perfiles-permisos.md (§1). Si ahí cambia un rol, aquí también.
 */
object Rol {
    const val ADMINISTRADOR = "Administrador"
    const val ANALISTA = "Analista comercial"
    const val GERENTE_CATEGORIA = "Gerente de categoría"
    const val RESPONSABLE_PRECIOS = "Responsable de precios"
    const val PLANEADOR = "Planeador"
    const val AUDITOR = "Auditor"
    const val PROVEEDOR = "Proveedor"

    /**
     * D-28: usuario de la app móvil. Lee productos, presentaciones, tiendas y zonas, y da de alta
     * precios observados y disponibilidad. Sin acceso a lo demás (Matriz §3, nota 6).
     */
    const val INVESTIGADOR = "Investigador de mercado"

    /**
     * Los seis perfiles internos de la Matriz S0. El Investigador también es interno (§1), pero va
     * aparte porque solo tiene los permisos de D-28: donde un servicio dice "los 6 perfiles
     * internos", el Investigador NO entra.
     */
    val INTERNOS = setOf(ADMINISTRADOR, ANALISTA, GERENTE_CATEGORIA, RESPONSABLE_PRECIOS, PLANEADOR, AUDITOR)
}

/**
 * Tipos de captura de la versión 1.0 del contrato de offline-sync-service (§2, tabla "Permiso por
 * tipo de captura"). Visitas de campo (D-30) y propuesta de producto desde campo (D-32) están
 * PENDIENTES en el contrato (§6) y no entran en 1.0.
 */
object TipoCaptura {
    const val PRECIO_OBSERVADO = "precio_observado"
    const val DISPONIBILIDAD = "disponibilidad"

    /** Rol que cada tipo acepta en su servicio destino (pricing y availability). */
    private val ROLES_POR_TIPO = mapOf(
        PRECIO_OBSERVADO to setOf(Rol.INVESTIGADOR, Rol.ANALISTA, Rol.RESPONSABLE_PRECIOS),
        DISPONIBILIDAD to setOf(Rol.INVESTIGADOR, Rol.ANALISTA),
    )

    /** Roles que pueden mandar lotes a POST /v1/sync/batches (contrato §2). */
    val ROLES_QUE_SINCRONIZAN: Set<String> = ROLES_POR_TIPO.values.flatten().toSet()

    /** Tipos que el rol puede capturar, en el orden en que se ofrecen en pantalla. */
    fun permitidosPara(rol: String?): List<String> =
        listOf(PRECIO_OBSERVADO, DISPONIBILIDAD).filter { rol != null && rol in ROLES_POR_TIPO.getValue(it) }
}
