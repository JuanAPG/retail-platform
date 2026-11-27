package com.udem.retaildecision.ui.scanner

import com.udem.retaildecision.data.model.Rol
import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.remote.dto.PresentacionDto
import com.udem.retaildecision.data.remote.dto.ProductDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

internal fun presentacion(id: String, codigo: String?, activo: Boolean = true, productoId: String = "prod-1") =
    PresentacionDto(id = id, productoId = productoId, nombre = "Bolsa $id", contenido = "1.000", codigoBarras = codigo, activo = activo)

internal fun producto(id: String, nombre: String, vararg presentaciones: PresentacionDto, estatus: String = "activo") =
    ProductDto(id = id, sku = "SKU-$id", nombre = nombre, categoriaId = 1, estatus = estatus, presentaciones = presentaciones.toList())

/** Botones de captura del escáner y búsqueda del código (también la que usa Capturas en tienda). */
class EscanerCapturaTest {

    private val frijol = producto("p1", "Frijol negro", presentacion("pr1", "7501000111222"), presentacion("pr2", "7501000111333"))
    private val pres = frijol.presentaciones.first()

    private fun botones(rol: String?) = botonesCaptura(TipoCaptura.permitidosPara(rol), frijol, pres)

    @Test
    fun `Investigador y Analista - los dos botones`() {
        val ambos = listOf(TipoCaptura.PRECIO_OBSERVADO, TipoCaptura.DISPONIBILIDAD)
        assertEquals(ambos, botones(Rol.INVESTIGADOR))
        assertEquals(ambos, botones(Rol.ANALISTA))
        assertEquals(listOf("Capturar precio", "Capturar existencia"), botones(Rol.INVESTIGADOR).map(::textoBotonCaptura))
    }

    @Test
    fun `Responsable de precios - solo precio`() {
        assertEquals(listOf(TipoCaptura.PRECIO_OBSERVADO), botones(Rol.RESPONSABLE_PRECIOS))
    }

    @Test
    fun `Planeador y los demas que no capturan - ningun boton`() {
        listOf(Rol.PLANEADOR, Rol.GERENTE_CATEGORIA, Rol.ADMINISTRADOR, Rol.AUDITOR, Rol.PROVEEDOR, null).forEach {
            assertTrue("$it sin botones", botones(it).isEmpty())
        }
    }

    @Test
    fun `sin producto encontrado o presentacion inactiva - ningun boton`() {
        val todos = TipoCaptura.permitidosPara(Rol.ANALISTA)
        assertTrue(botonesCaptura(todos, null, null).isEmpty())
        assertTrue(botonesCaptura(todos, frijol, presentacion("x", "1", activo = false)).isEmpty())
        assertTrue(botonesCaptura(todos, frijol.copy(estatus = "pendiente_aprobacion"), pres).isEmpty())
    }

    @Test
    fun `el Investigador ve botones pero el escaner no le muestra precios`() {
        // D-28: muestraPrecios=false y tiposCaptura con los dos tipos.
        val s = ScannerUiState(
            cargandoCatalogo = false, escaneando = false, codigo = "7501000111222", producto = frijol, presentacion = pres,
            muestraPrecios = false, tiposCaptura = TipoCaptura.permitidosPara(Rol.INVESTIGADOR),
        )
        assertEquals(false, s.muestraPrecios)
        assertTrue(s.precios.isEmpty())
        assertEquals(2, s.botonesCaptura.size)
    }

    @Test
    fun `indice de codigos - encuentra, ignora ceros a la izquierda, y no encontrado es null`() {
        val indice = IndiceCodigos(listOf(frijol))
        assertEquals("pr1", indice.buscar("7501000111222")!!.second.id)
        assertEquals("pr1", indice.buscar(" 07501000111222 ")!!.second.id)
        assertEquals("pr2", indice.buscar("7501000111333")!!.second.id)
        assertNull(indice.buscar("9999999999999"))
        assertNull(indice.buscar(""))
        assertNull(indice.buscar("0000"))
    }

    @Test
    fun `indice para capturar - deja fuera presentaciones inactivas y productos pendientes`() {
        val inactiva = producto("p2", "Arroz", presentacion("pr3", "111", activo = false))
        val pendiente = producto("p3", "Nuevo", presentacion("pr4", "222"), estatus = "pendiente_aprobacion")
        val indice = IndiceCodigos(listOf(frijol, inactiva, pendiente), soloCapturables = true)
        assertNull(indice.buscar("111"))
        assertNull(indice.buscar("222"))
        assertEquals("pr1", indice.buscar("7501000111222")!!.second.id)
        // Sin el filtro (pantalla del escáner) sí se identifican.
        assertEquals("pr3", IndiceCodigos(listOf(inactiva)).buscar("111")!!.second.id)
    }
}
