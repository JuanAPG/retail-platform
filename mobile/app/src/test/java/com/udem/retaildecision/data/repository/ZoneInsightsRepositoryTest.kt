package com.udem.retaildecision.data.repository

import com.google.gson.Gson
import com.udem.retaildecision.data.remote.AvailabilityApi
import com.udem.retaildecision.data.remote.SegmentationApi
import com.udem.retaildecision.data.remote.dto.PageResponse
import com.udem.retaildecision.data.remote.dto.ZoneClassificationDto
import com.udem.retaildecision.data.remote.dto.ZoneCoverageDto
import com.udem.retaildecision.ui.zones.Indicador
import com.udem.retaildecision.ui.zones.indicadorCobertura
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response
import java.io.IOException

private const val ZONA = "f2670df2-0000-4000-8000-000000000001"

private fun <T> error(codigo: Int): Response<T> = Response.error(
    codigo,
    """{"statusCode":$codigo,"message":"x","code":"X","details":null,"path":"/v1/x","timestamp":"2026-10-30T15:02:01.120Z"}"""
        .toResponseBody("application/json".toMediaType()),
)

private fun clasif(zona: String) = ZoneClassificationDto(id = "c-$zona", zoneId = zona, segmentCode = "ING_1", segmentName = "Ingreso bajo")

private class SegmentationFalso(
    val unaZona: () -> Response<ZoneClassificationDto>,
    val paginas: List<List<ZoneClassificationDto>> = emptyList(),
) : SegmentationApi {
    val paginasPedidas = mutableListOf<Int>()
    override suspend fun getZoneClassifications(current: Boolean, page: Int, limit: Int): Response<PageResponse<ZoneClassificationDto>> {
        paginasPedidas += page
        return Response.success(PageResponse(paginas.getOrElse(page - 1) { emptyList() }, paginas.sumOf { it.size }, page, limit))
    }

    override suspend fun getZoneClassification(zoneId: String) = unaZona()
}

private class AvailabilityFalso(val respuesta: () -> Response<ZoneCoverageDto>) : AvailabilityApi {
    override suspend fun getZoneCoverage(zoneId: String) = respuesta()
}

private fun repo(
    unaZona: () -> Response<ZoneClassificationDto> = { Response.success(clasif(ZONA)) },
    paginas: List<List<ZoneClassificationDto>> = emptyList(),
    cobertura: () -> Response<ZoneCoverageDto> = { Response.success(ZoneCoverageDto(zoneId = ZONA, disponible = true, coverage = 75.0)) },
    onSesionExpirada: () -> Unit = {},
) = ZoneInsightsRepository(SegmentationFalso(unaZona, paginas), AvailabilityFalso(cobertura), onSesionExpirada)

class ZoneInsightsRepositoryTest {

    @Test
    fun `zona sin clasificacion vigente (404) es exito con null, no error`() = runBlocking<Unit> {
        val r = repo(unaZona = { error(404) }).clasificacion(ZONA)
        assertTrue(r.isSuccess)
        assertNull(r.getOrThrow())
    }

    @Test
    fun `sin red - SinConexionException en clasificacion y cobertura`() = runBlocking<Unit> {
        val r = repo(unaZona = { throw IOException("sin red") }, cobertura = { throw IOException("sin red") })
        assertTrue(r.clasificacion(ZONA).exceptionOrNull() is SinConexionException)
        assertTrue(r.cobertura(ZONA).exceptionOrNull() is SinConexionException)
        assertTrue(r.clasificacionesVigentes().isSuccess) // la lista usa otra ruta que sí respondió
    }

    @Test
    fun `403 o 500 son falla, pero no de conexion`() = runBlocking<Unit> {
        val r = repo(unaZona = { error(403) }, cobertura = { error(500) })
        val e1 = r.clasificacion(ZONA).exceptionOrNull()!!
        val e2 = r.cobertura(ZONA).exceptionOrNull()!!
        assertTrue(e1 !is SinConexionException && e2 !is SinConexionException)
        assertEquals("El servidor respondió con error (500).", e2.message)
    }

    @Test
    fun `401 avisa que la sesion expiro`() = runBlocking<Unit> {
        var expirada = 0
        repo(cobertura = { error(401) }, onSesionExpirada = { expirada++ }).cobertura(ZONA)
        assertEquals(1, expirada)
    }

    @Test
    fun `cobertura disponible false tal como la manda el servicio`() = runBlocking<Unit> {
        // JSON del contrato: sin "coverage" cuando disponible es false.
        val json = """{"zoneId":"$ZONA","validDays":7,"stores":2,"basics":4,"covered":0,"disponible":false,"motivo":"Ninguna tienda tiene datos vigentes.","items":[],"byStore":[]}"""
        val dto = Gson().fromJson(json, ZoneCoverageDto::class.java)
        val r = repo(cobertura = { Response.success(dto) }).cobertura(ZONA)
        assertNull(r.getOrThrow().coverage)
        assertEquals(Indicador.Aviso("Sin datos vigentes"), indicadorCobertura(r.getOrThrow()))
    }

    @Test
    fun `clasificaciones vigentes - pide todas las paginas`() = runBlocking<Unit> {
        val seg = SegmentationFalso(
            unaZona = { Response.success(clasif(ZONA)) },
            paginas = listOf(List(100) { clasif("z$it") }, listOf(clasif("z100"), clasif("z101"))),
        )
        val r = ZoneInsightsRepository(seg, AvailabilityFalso { error(500) }).clasificacionesVigentes()
        assertEquals(102, r.getOrThrow().size)
        assertEquals(listOf(1, 2), seg.paginasPedidas)
    }
}
