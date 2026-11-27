package com.udem.retaildecision.ui.observations

import com.udem.retaildecision.data.local.UltimaTiendaPorUsuario
import com.udem.retaildecision.data.model.Rol
import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.ui.scanner.presentacion
import com.udem.retaildecision.ui.scanner.producto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/** Relleno del formulario de Capturas en tienda desde el escáner y con el botón "Escanear". */
class RellenoCapturaTest {

    private val frijol = producto("p1", "Frijol negro", presentacion("pr1", "7501000111222"), presentacion("pr2", "7501000111333"))
    private val leche = producto("p2", "Leche entera", presentacion("pr3", "7502000222000"), presentacion("pr4", "7502000222111", activo = false))
    private val norte = StoreDto(id = "t-norte", nombre = "Abarrotes Norte")
    private val sur = StoreDto(id = "t-sur", nombre = "Bodega Sur")

    /** Estado recién cargado, como lo deja cargarCatalogo antes de aplicar la preselección. */
    private fun cargado(rol: String) = TipoCaptura.permitidosPara(rol).let { tipos ->
        ObservationsUiState(
            tipos = tipos, tipo = tipos.first(), cargandoCatalogo = false,
            tiendas = listOf(norte, sur), productos = listOf(frijol, leche),
        )
    }

    private val desdeEscaner = Preseleccion(presentacionId = "pr2", tipo = TipoCaptura.DISPONIBILIDAD, codigo = "7501000111333")

    @Test
    fun `desde el escaner el formulario llega lleno - producto, presentacion, tipo, codigo y ultima tienda`() {
        val s = aplicarPreseleccion(cargado(Rol.INVESTIGADOR), desdeEscaner, ultimaTiendaId = "t-sur")
        assertEquals(frijol, s.producto)
        assertEquals("pr2", s.presentacion!!.id)
        assertEquals("Frijol negro", s.busqueda)
        assertEquals(TipoCaptura.DISPONIBILIDAD, s.tipo)
        assertEquals("7501000111333", s.codigoEscaneado)
        assertEquals(sur, s.tienda)
        // Solo falta el dato y la ubicación: el usuario no escribe nada más.
        assertEquals("", s.valorTexto)
        assertNull(s.avisoEscaneo)
    }

    @Test
    fun `sin ultima tienda guardada la tienda queda por elegir`() {
        val s = aplicarPreseleccion(cargado(Rol.ANALISTA), desdeEscaner, ultimaTiendaId = null)
        assertNull(s.tienda)
        assertEquals("pr2", s.presentacion!!.id)
    }

    @Test
    fun `una ultima tienda que ya no esta activa se ignora`() {
        val s = aplicarPreseleccion(cargado(Rol.ANALISTA), desdeEscaner, ultimaTiendaId = "t-cerrada")
        assertNull(s.tienda)
    }

    @Test
    fun `la ultima tienda no se usa si no se viene del escaner`() {
        val s = aplicarPreseleccion(cargado(Rol.ANALISTA), Preseleccion(), ultimaTiendaId = "t-sur")
        assertNull(s.tienda)
        assertNull(s.producto)
    }

    @Test
    fun `desde el Detalle de zona - la tienda pedida`() {
        val s = aplicarPreseleccion(cargado(Rol.INVESTIGADOR), Preseleccion(tiendaId = "t-norte"), ultimaTiendaId = "t-sur")
        assertEquals(norte, s.tienda)
    }

    @Test
    fun `el Responsable de precios no recibe el tipo existencia aunque llegue en la ruta`() {
        val s = aplicarPreseleccion(cargado(Rol.RESPONSABLE_PRECIOS), desdeEscaner, ultimaTiendaId = null)
        assertEquals(TipoCaptura.PRECIO_OBSERVADO, s.tipo)
        assertEquals("pr2", s.presentacion!!.id)
    }

    @Test
    fun `presentacion escaneada que ya no esta activa - aviso y formulario vacio`() {
        val s = aplicarPreseleccion(cargado(Rol.ANALISTA), Preseleccion(presentacionId = "pr4", codigo = "7502000222111"), null)
        assertNull(s.producto)
        assertNull(s.presentacion)
        assertEquals(ESCANEADO_NO_CAPTURABLE, s.avisoEscaneo)
    }

    @Test
    fun `boton Escanear - codigo del catalogo elige producto y presentacion`() {
        val antes = cargado(Rol.INVESTIGADOR).copy(tienda = norte, valorTexto = "12", escaneando = true)
        val s = aplicarCodigoLeido(antes, "7502000222000")
        assertEquals(leche, s.producto)
        assertEquals("pr3", s.presentacion!!.id)
        assertEquals("7502000222000", s.codigoEscaneado)
        assertEquals(false, s.escaneando)
        // Lo demás se queda como estaba.
        assertEquals(norte, s.tienda)
        assertEquals("12", s.valorTexto)
    }

    @Test
    fun `boton Escanear - codigo no encontrado avisa y el formulario sigue igual`() {
        val antes = aplicarCodigoLeido(cargado(Rol.ANALISTA).copy(tienda = sur, valorTexto = "27.50", escaneando = true), "7501000111222")
            .copy(escaneando = true)
        val s = aplicarCodigoLeido(antes, "0000123")
        assertEquals("Código no encontrado en el catálogo", s.avisoEscaneo)
        assertEquals(false, s.escaneando)
        assertEquals(antes.copy(escaneando = false, avisoEscaneo = CODIGO_NO_ENCONTRADO), s)
        assertEquals("pr1", s.presentacion!!.id)
        assertEquals(sur, s.tienda)
    }

    @Test
    fun `boton Escanear - presentacion inactiva cuenta como no encontrada`() {
        val antes = cargado(Rol.ANALISTA).copy(escaneando = true)
        assertEquals(CODIGO_NO_ENCONTRADO, aplicarCodigoLeido(antes, "7502000222111").avisoEscaneo)
    }

    @Test
    fun `boton Escanear sin internet - busca en los productos de la copia guardada`() {
        // cargarCatalogo pone en `productos` la copia del teléfono si no hay red: la búsqueda no pide nada al servidor.
        val copia = cargado(Rol.INVESTIGADOR).copy(usandoCopiaLocal = true, escaneando = true)
        assertEquals("pr1", aplicarCodigoLeido(copia, "7501000111222").presentacion!!.id)
    }

    // ------------------------------------------------------------ última tienda por usuario

    private class Prefs {
        val valores = mutableMapOf<String, String>()
        val almacen = UltimaTiendaPorUsuario(leerValor = { valores[it] }, escribirValor = { k, v -> valores[k] = v })
    }

    @Test
    fun `la ultima tienda se recuerda por usuario y otro usuario no la ve`() {
        val p = Prefs()
        p.almacen.recordar("ana", "t-sur")
        assertEquals("t-sur", p.almacen.de("ana"))
        assertNull(p.almacen.de("beto"))

        p.almacen.recordar("beto", "t-norte")
        assertEquals("t-sur", p.almacen.de("ana"))
        assertEquals("t-norte", p.almacen.de("beto"))

        p.almacen.recordar("ana", "t-norte")
        assertEquals("t-norte", p.almacen.de("ana"))
    }

    @Test
    fun `sin usuario no se guarda ni se lee nada`() {
        val p = Prefs()
        p.almacen.recordar(null, "t-sur")
        p.almacen.recordar("  ", "t-sur")
        assertEquals(emptyMap<String, String>(), p.valores)
        assertNull(p.almacen.de(null))
    }

    @Test
    fun `la preseleccion no cambia una tienda ya elegida`() {
        val elegida = cargado(Rol.ANALISTA).copy(tienda = norte)
        assertSame(norte, aplicarPreseleccion(elegida, desdeEscaner, "t-sur").tienda)
    }
}
