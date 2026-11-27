package com.udem.retaildecision.ui.catalog

import com.udem.retaildecision.data.model.Rol
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.ZoneDto
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Catálogo del Proveedor: solo Productos. GET /v1/zones es de los 6 internos y el Investigador
 * (catalog le responde 403 al Proveedor), así que ni se pide ni hay pestaña Zonas.
 */
class CatalogoProveedorTest {

    private val producto = ProductDto(id = "p1", sku = "SKU-1", nombre = "Frijol negro", categoriaId = 1, estatus = "activo")
    private val zona = ZoneDto(id = "z1", nombre = "Zona Centro", municipioId = 1)

    /** Carga como el ViewModel, contando cuántas veces se pidieron zonas. */
    private fun cargar(rol: String?, zonas: Result<List<ZoneDto>> = Result.success(listOf(zona))): Pair<CatalogUiState, Int> {
        var pedidasZonas = 0
        val estado = runBlocking {
            cargarCatalogo(
                muestraZonas = catalogoMuestraZonas(rol),
                productos = { Result.success(listOf(producto)) },
                zonas = { pedidasZonas++; zonas },
                tiendas = null,
                clasificaciones = null,
                cache = null,
            )
        }
        return estado to pedidasZonas
    }

    @Test
    fun `Proveedor - sin pestana Zonas y sin pedir zonas`() {
        assertFalse(catalogoMuestraZonas(Rol.PROVEEDOR))
        val (estado, pedidas) = cargar(Rol.PROVEEDOR)
        assertEquals(0, pedidas)
        assertFalse(estado.muestraZonas)
        assertTrue(estado.zonas.isEmpty())
        assertEquals(listOf(producto), estado.productos)
        assertNull(estado.error)
    }

    @Test
    fun `rol interno - con pestana Zonas y zonas pedidas`() {
        val (estado, pedidas) = cargar(Rol.ANALISTA)
        assertEquals(1, pedidas)
        assertTrue(estado.muestraZonas)
        assertEquals(listOf(zona), estado.zonas)
        assertEquals(listOf(producto), estado.productos)
    }

    @Test
    fun `quien ve la pestana Zonas - los 6 internos y el Investigador, nadie mas`() {
        (Rol.INTERNOS + Rol.INVESTIGADOR).forEach { assertTrue(it, catalogoMuestraZonas(it)) }
        listOf(Rol.PROVEEDOR, null, "Rol inventado").forEach { assertFalse("$it", catalogoMuestraZonas(it)) }
    }

    @Test
    fun `Proveedor - si fallan los productos se muestra el error (no hay zonas que lo salven)`() {
        val estado = runBlocking {
            cargarCatalogo(
                muestraZonas = false,
                productos = { Result.failure(Exception("No se pudo conectar con el servidor.")) },
                zonas = { error("no se deben pedir zonas") },
                tiendas = null,
                clasificaciones = null,
                cache = null,
            )
        }
        assertEquals("No se pudo conectar con el servidor.", estado.error)
    }
}
