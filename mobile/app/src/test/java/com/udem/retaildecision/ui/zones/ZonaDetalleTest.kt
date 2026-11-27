package com.udem.retaildecision.ui.zones

import com.udem.retaildecision.data.local.AlmacenListas
import com.udem.retaildecision.data.model.Rol
import com.udem.retaildecision.data.remote.dto.StoreDireccionDto
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.remote.dto.ZoneClassificationDto
import com.udem.retaildecision.data.remote.dto.ZoneCoverageDto
import com.udem.retaildecision.data.repository.SinConexionException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/** Copia del teléfono en memoria, con las mismas reglas que CatalogCache. */
private class CacheEnMemoria : AlmacenListas {
    val listas = mutableMapOf<String, List<Any?>>()
    override fun <T> guardar(clave: String, lista: List<T>) {
        listas[clave] = lista
    }

    @Suppress("UNCHECKED_CAST")
    override fun <T> leer(clave: String, tipo: Class<T>): List<T>? = listas[clave] as List<T>?
}

private const val ZONA = "f2670df2-0000-4000-8000-000000000001"
private const val OTRA_ZONA = "f2670df2-0000-4000-8000-000000000002"

private fun tienda(id: String, nombre: String, zona: String = ZONA, activo: Boolean = true, lat: String? = null, lon: String? = null) =
    StoreDto(
        id = id, nombre = nombre, formato = "minimarket", numeroSucursal = "SUC-$id", activo = activo, zonaId = zona,
        direccion = StoreDireccionDto(calle = "Av. Constitución", numeroExterior = "1050", colonia = "Centro", codigoPostal = "64000", latitud = lat, longitud = lon),
    )

private fun clasif(nombre: String?, codigo: String?, zona: String = ZONA, desde: String = "2026-09-25", vigente: Boolean = true) =
    ZoneClassificationDto(
        id = "c-$zona-$desde", zoneId = zona, segmentCode = codigo, segmentName = nombre,
        validFrom = desde, validTo = if (vigente) null else "2026-10-01", current = vigente,
    )

private fun cobertura(disponible: Boolean, valor: Double?) =
    ZoneCoverageDto(zoneId = ZONA, disponible = disponible, coverage = valor, motivo = if (disponible) null else "Sin datos vigentes de básicos.")

/** Cargador con contadores, para comprobar qué se pidió y qué no. */
private class Escenario(
    rol: String?,
    var tiendas: () -> Result<List<StoreDto>> = { Result.success(listOf(tienda("2", "Bodega Sur"), tienda("1", "Abarrotes Norte"))) },
    var clasificacion: () -> Result<ZoneClassificationDto?> = { Result.success(clasif("Ingreso bajo", "ING_1")) },
    var cobertura: () -> Result<ZoneCoverageDto> = { Result.success(cobertura(true, 75.0)) },
) {
    val cache = CacheEnMemoria()
    var pedidasClasificacion = 0
    var pedidasCobertura = 0
    val permisos = permisosZona(rol)
    val cargador = CargadorDetalleZona(
        permisos = permisos,
        tiendasRemotas = { tiendas() },
        pedirClasificacion = { pedidasClasificacion++; clasificacion() },
        pedirCobertura = { pedidasCobertura++; cobertura() },
        cache = cache,
    )

    fun cargar(): DetalleZona = runBlocking { cargador.cargar(ZONA) }
}

class ZonaDetalleTest {

    // ---------------------------------------------------------------- qué ve cada rol

    @Test
    fun `Investigador - sin ingreso ni cobertura, y si puede capturar`() {
        val p = permisosZona(Rol.INVESTIGADOR)
        assertFalse(p.veIngreso)
        assertFalse(p.veCobertura)
        assertTrue(p.puedeCapturar)
    }

    @Test
    fun `los 6 perfiles internos ven ingreso y cobertura`() {
        Rol.INTERNOS.forEach { rol ->
            val p = permisosZona(rol)
            assertTrue("$rol ve ingreso", p.veIngreso)
            assertTrue("$rol ve cobertura", p.veCobertura)
        }
        assertEquals(6, Rol.INTERNOS.size)
    }

    @Test
    fun `Capturar aqui - solo Investigador, Analista y Responsable de precios`() {
        val todos = Rol.INTERNOS + Rol.PROVEEDOR + Rol.INVESTIGADOR
        val capturan = todos.filter { permisosZona(it).puedeCapturar }.toSet()
        assertEquals(setOf(Rol.INVESTIGADOR, Rol.ANALISTA, Rol.RESPONSABLE_PRECIOS), capturan)
        assertFalse(permisosZona(null).puedeCapturar)
    }

    @Test
    fun `Proveedor y rol desconocido no ven nada de la zona`() {
        listOf(Rol.PROVEEDOR, null, "Rol inventado").forEach {
            assertEquals(PermisosZona(veIngreso = false, veCobertura = false, puedeCapturar = false), permisosZona(it))
        }
    }

    @Test
    fun `detalle del Investigador - no se piden income-segmentation ni availability`() {
        val e = Escenario(Rol.INVESTIGADOR)
        val d = e.cargar()
        assertEquals(Indicador.Oculto, d.ingreso)
        assertEquals(Indicador.Oculto, d.cobertura)
        assertEquals(0, e.pedidasClasificacion)
        assertEquals(0, e.pedidasCobertura)
        assertEquals(2, d.tiendas!!.size)
    }

    @Test
    fun `detalle de un interno - ingreso, cobertura y tiendas ordenadas por nombre`() {
        val d = Escenario(Rol.PLANEADOR).cargar()
        assertEquals(Indicador.Listo(NivelIngreso("Ingreso bajo", TonoIngreso.BAJO)), d.ingreso)
        assertEquals(Indicador.Listo("75 %"), d.cobertura)
        assertEquals(listOf("Abarrotes Norte", "Bodega Sur"), d.tiendas!!.map { it.nombre })
        assertFalse(d.tiendasDesdeCopia)
        assertNull(d.errorTiendas)
    }

    // ---------------------------------------------------------------- cobertura

    @Test
    fun `cobertura con disponible false es Sin datos vigentes, nunca 0 por ciento`() {
        assertEquals(Indicador.Aviso("Sin datos vigentes"), indicadorCobertura(cobertura(false, null)))
        // Aunque el servidor mandara un número junto con disponible:false, no se muestra.
        assertEquals(Indicador.Aviso("Sin datos vigentes"), indicadorCobertura(cobertura(false, 0.0)))
        // disponible:true sin número tampoco se inventa como 0.
        assertEquals(Indicador.Aviso("Sin datos vigentes"), indicadorCobertura(cobertura(true, null)))
        assertEquals(Indicador.Aviso("Sin datos vigentes"), indicadorCobertura(cobertura(true, Double.NaN)))
    }

    @Test
    fun `cobertura disponible - formato del porcentaje`() {
        assertEquals(Indicador.Listo("75 %"), indicadorCobertura(cobertura(true, 75.0)))
        assertEquals(Indicador.Listo("66.67 %"), indicadorCobertura(cobertura(true, 66.67)))
        assertEquals(Indicador.Listo("62.5 %"), indicadorCobertura(cobertura(true, 62.5)))
        // Un 0 real (hay datos vigentes y ningún básico cubierto) sí se muestra.
        assertEquals(Indicador.Listo("0 %"), indicadorCobertura(cobertura(true, 0.0)))
    }

    @Test
    fun `detalle con cobertura disponible false`() {
        val d = Escenario(Rol.ANALISTA, cobertura = { Result.success(cobertura(false, null)) }).cargar()
        assertEquals(Indicador.Aviso(SIN_DATOS_VIGENTES), d.cobertura)
    }

    // ---------------------------------------------------------------- nivel de ingreso

    @Test
    fun `nivel de ingreso por nombre del segmento y, si no, por codigo`() {
        assertEquals(TonoIngreso.BAJO, nivelDeIngreso(clasif("Ingreso bajo", "ING_1")).tono)
        assertEquals(TonoIngreso.MEDIO, nivelDeIngreso(clasif("Ingreso MEDIO", "X")).tono)
        assertEquals(TonoIngreso.ALTO, nivelDeIngreso(clasif("ingreso alto", null)).tono)
        assertEquals(NivelIngreso("Ingreso medio", TonoIngreso.MEDIO), nivelDeIngreso(clasif(null, "ING_2")))
        assertEquals(NivelIngreso("Ingreso alto", TonoIngreso.ALTO), nivelDeIngreso(clasif("Segmento C", "ING_3")))
        assertEquals(NivelIngreso("Ingreso muy variable", TonoIngreso.NEUTRO), nivelDeIngreso(clasif("Ingreso muy variable", "ING_9")))
        // "altos" o "Altamira" no son "alto".
        assertEquals(TonoIngreso.NEUTRO, nivelDeIngreso(clasif("Altamira", null)).tono)
    }

    @Test
    fun `nivel por zona - solo vigentes y la mas reciente si hubiera dos`() {
        val niveles = nivelesPorZona(
            listOf(
                clasif("Ingreso bajo", "ING_1", desde = "2026-01-01"),
                clasif("Ingreso alto", "ING_3", desde = "2026-10-01"),
                clasif("Ingreso medio", "ING_2", zona = OTRA_ZONA, vigente = false),
            ),
        )
        assertEquals(mapOf(ZONA to NivelIngreso("Ingreso alto", TonoIngreso.ALTO)), niveles)
    }

    @Test
    fun `zona sin clasificacion vigente - aviso, no error`() {
        val d = Escenario(Rol.GERENTE_CATEGORIA, clasificacion = { Result.success(null) }).cargar()
        assertEquals(Indicador.Aviso(SIN_CLASIFICACION), d.ingreso)
    }

    // ---------------------------------------------------------------- tiendas: formato, dirección, mapa, conteo

    @Test
    fun `formato legible de la tienda`() {
        assertEquals("Supermercado", formatoLegible("supermercado"))
        assertEquals("Minimarket", formatoLegible("minimarket"))
        assertEquals("Tienda de conveniencia", formatoLegible("tienda_conveniencia"))
        assertEquals("Mayorista", formatoLegible("mayorista"))
        assertEquals("Otro formato", formatoLegible("otro"))
        assertEquals("Formato nuevo", formatoLegible("formato_nuevo"))
        assertNull(formatoLegible(null))
        assertNull(formatoLegible("  "))
    }

    @Test
    fun `direccion legible - calle numero, colonia, CP`() {
        val completa = StoreDireccionDto(calle = "Av. Constitución", numeroExterior = "1050", colonia = "Centro", codigoPostal = "64000")
        assertEquals("Av. Constitución 1050, Centro, CP 64000", direccionLegible(completa))
        assertEquals("Hidalgo, CP 64000", direccionLegible(StoreDireccionDto(calle = "Hidalgo", codigoPostal = "64000")))
        assertEquals("Centro", direccionLegible(StoreDireccionDto(colonia = " Centro ", numeroExterior = "")))
        assertEquals("Sin dirección registrada", direccionLegible(StoreDireccionDto()))
        assertEquals("Sin dirección registrada", direccionLegible(null))
    }

    @Test
    fun `Ver en mapa - solo con latitud y longitud validas`() {
        val con = tienda("1", "Abarrotes Norte", lat = "25.686600", lon = "-100.316100")
        assertEquals(25.6866 to -100.3161, coordenadas(con))
        assertEquals("geo:25.686600,-100.316100?q=25.686600,-100.316100(Abarrotes%20Norte)", uriMapa(con))
        assertNull(coordenadas(tienda("2", "Sin longitud", lat = "25.68")))
        assertNull(coordenadas(tienda("3", "Sin coordenadas")))
        assertNull(coordenadas(tienda("4", "Texto raro", lat = "abc", lon = "-100.3")))
        assertNull(coordenadas(tienda("5", "Fuera de rango", lat = "125.0", lon = "-100.3")))
        assertNull(uriMapa(tienda("6", "Sin coordenadas")))
        assertNull(coordenadas(StoreDto(id = "7", nombre = "Sin dirección")))
    }

    @Test
    fun `numero de tiendas activas por zona`() {
        val conteo = tiendasPorZona(
            listOf(
                tienda("1", "A"), tienda("2", "B"), tienda("3", "C", activo = false),
                tienda("4", "D", zona = OTRA_ZONA), StoreDto(id = "5", nombre = "Sin zona"),
            ),
        )
        assertEquals(mapOf(ZONA to 2, OTRA_ZONA to 1), conteo)
        assertEquals("1 tienda", textoTiendas(1))
        assertEquals("4 tiendas", textoTiendas(4))
        assertEquals("0 tiendas", textoTiendas(0))
    }

    // ---------------------------------------------------------------- sin red: el detalle no se rompe

    @Test
    fun `sin red - tiendas de la copia de la zona e indicadores ocultos con aviso`() {
        val e = Escenario(Rol.ADMINISTRADOR)
        e.cargar() // primera vez con red: guarda la copia
        e.tiendas = { Result.failure(Exception("No se pudo conectar con el servidor. Revisa tu conexión.")) }
        e.clasificacion = { Result.failure(SinConexionException()) }
        e.cobertura = { Result.failure(SinConexionException()) }

        val d = e.cargar()
        assertEquals(listOf("Abarrotes Norte", "Bodega Sur"), d.tiendas!!.map { it.nombre })
        assertTrue(d.tiendasDesdeCopia)
        assertNull(d.errorTiendas)
        assertEquals(Indicador.Aviso("No disponible sin conexión"), d.ingreso)
        assertEquals(Indicador.Aviso("No disponible sin conexión"), d.cobertura)
    }

    @Test
    fun `sin red y sin copia de la zona - usa la lista general de tiendas filtrada por zona`() {
        val e = Escenario(Rol.INVESTIGADOR, tiendas = { Result.failure(SinConexionException()) })
        e.cache.guardar("tiendas", listOf(tienda("1", "Mía"), tienda("2", "De otra zona", zona = OTRA_ZONA), tienda("3", "Cerrada", activo = false)))
        val d = e.cargar()
        assertEquals(listOf("Mía"), d.tiendas!!.map { it.nombre })
        assertTrue(d.tiendasDesdeCopia)
    }

    @Test
    fun `sin red y sin ninguna copia - mensaje claro, sin lanzar`() {
        val d = Escenario(Rol.ANALISTA, tiendas = { Result.failure(Exception("No se pudo conectar con el servidor.")) }).cargar()
        assertNull(d.tiendas)
        assertTrue(d.errorTiendas!!.startsWith("No se pudo conectar con el servidor."))
    }

    @Test
    fun `una excepcion inesperada en cualquier fuente no rompe el detalle`() {
        val e = Escenario(
            Rol.AUDITOR,
            tiendas = { throw IOException("socket cerrado") },
            clasificacion = { throw IllegalStateException("JSON raro") },
            cobertura = { Result.failure(Exception("El servidor respondió con error (500).")) },
        )
        val d = e.cargar()
        assertNull(d.tiendas)
        assertTrue(d.errorTiendas != null)
        assertEquals(Indicador.Aviso(NO_DISPONIBLE), d.ingreso)
        assertEquals(Indicador.Aviso(NO_DISPONIBLE), d.cobertura)
    }

    @Test
    fun `al volver la red la copia de la zona se reemplaza`() {
        val e = Escenario(Rol.ANALISTA)
        e.cargar()
        e.tiendas = { Result.success(listOf(tienda("9", "Nueva"))) }
        e.cargar()
        @Suppress("UNCHECKED_CAST")
        val copia = e.cache.listas[claveTiendasDeZona(ZONA)] as List<StoreDto>
        assertEquals(listOf("Nueva"), copia.map { it.nombre })
    }
}
