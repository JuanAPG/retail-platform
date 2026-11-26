package com.udem.retaildecision.data.model

import com.udem.retaildecision.ui.home.seccionesParaRol
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** D-28 y la tabla "Permiso por tipo de captura" del contrato de offline-sync-service (§2). */
class RolesYMenuTest {

    @Test
    fun `el nombre del rol es exacto, con acentos, como en la tabla roles`() {
        assertEquals("Investigador de mercado", Rol.INVESTIGADOR)
    }

    @Test
    fun `tipos de captura por rol`() {
        val ambos = listOf(TipoCaptura.PRECIO_OBSERVADO, TipoCaptura.DISPONIBILIDAD)
        assertEquals(ambos, TipoCaptura.permitidosPara(Rol.INVESTIGADOR))
        assertEquals(ambos, TipoCaptura.permitidosPara(Rol.ANALISTA))
        assertEquals(listOf(TipoCaptura.PRECIO_OBSERVADO), TipoCaptura.permitidosPara(Rol.RESPONSABLE_PRECIOS))
        listOf(Rol.PLANEADOR, Rol.GERENTE_CATEGORIA, Rol.ADMINISTRADOR, Rol.AUDITOR, Rol.PROVEEDOR, null).forEach {
            assertTrue("$it no captura", TipoCaptura.permitidosPara(it).isEmpty())
        }
    }

    @Test
    fun `menú del Investigador - solo lo que D-28 le permite`() {
        val ids = seccionesParaRol(Rol.INVESTIGADOR).map { it.id }.toSet()
        assertEquals(setOf("catalogo", "escaner", "zonas", "visitas"), ids)
    }

    @Test
    fun `capturas en tienda - los tres roles que pueden sincronizar, y el Planeador no`() {
        val conCapturas = (Rol.INTERNOS + Rol.PROVEEDOR + Rol.INVESTIGADOR)
            .filter { rol -> seccionesParaRol(rol).any { it.id == "visitas" } }.toSet()
        assertEquals(setOf(Rol.INVESTIGADOR, Rol.ANALISTA, Rol.RESPONSABLE_PRECIOS), conCapturas)
        assertEquals("offline-sync-service", seccionesParaRol(Rol.INVESTIGADOR).first { it.id == "visitas" }.servicio)
    }
}
