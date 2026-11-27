package com.udem.retaildecision.data.sync

import com.google.gson.Gson
import com.udem.retaildecision.data.local.PendingVisitDao
import com.udem.retaildecision.data.local.PendingVisitEntity
import com.udem.retaildecision.data.location.Ubicacion
import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.remote.PricingApi
import com.udem.retaildecision.data.remote.dto.PresentacionDto
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.repository.ObservacionPayload
import com.udem.retaildecision.data.repository.ObservationRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Proxy
import java.time.OffsetDateTime
import java.time.ZoneOffset

/** Base de Room en memoria, solo para guardar e inspeccionar la fila. */
private class DaoEnMemoria : PendingVisitDao {
    val filas = mutableListOf<PendingVisitEntity>()
    override suspend fun insert(visit: PendingVisitEntity): Long {
        val fila = visit.copy(id = filas.size + 1L)
        filas += fila
        return fila.id
    }
    override suspend fun getUnsynced() = filas.filter { !it.synced }
    override suspend fun pendientesDe(userId: String) = filas.filter { !it.synced && it.userId == userId }
    override suspend fun porCaptureIds(captureIds: List<String>) = filas.filter { it.captureId in captureIds }
    override suspend fun getSynced() = filas.filter { it.synced }
    override suspend fun update(visit: PendingVisitEntity) {
        filas.replaceAll { if (it.id == visit.id) visit else it }
    }
    override fun observeAll(): Flow<List<PendingVisitEntity>> = flowOf(filas.toList())
    override suspend fun countUnsynced() = filas.count { !it.synced }
}

/** PricingApi que no se debe llamar al guardar. */
private val pricingQueNoSeUsa = Proxy.newProxyInstance(PricingApi::class.java.classLoader, arrayOf(PricingApi::class.java)) { _, m, _ ->
    error("guardar() no debe llamar a pricing (${m.name})")
} as PricingApi

/**
 * El SKU y el código de barras se guardan en `payloadJson` solo para la lista del teléfono. El lote que
 * se manda a offline-sync debe ser idéntico en forma al de antes (contrato: captureId, type,
 * contractVersion, capturedAt, storeId, presentationId, content).
 */
class LoteConEscaneoTest {

    private val gson = Gson()
    private val tienda = StoreDto(id = TIENDA, nombre = "Abarrotes Norte")
    private val pres = PresentacionDto(id = "5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77", productoId = "p1", nombre = "Bolsa 1 kg", contenido = "1.000", codigoBarras = "7501000111222")
    private val prod = ProductDto(id = "p1", sku = "FRI-001", nombre = "Frijol negro", categoriaId = 1, estatus = "activo", presentaciones = listOf(pres))

    private fun guardar(tipo: String, valor: Double, codigoEscaneado: String?): PendingVisitEntity = runBlocking {
        val dao = DaoEnMemoria()
        ObservationRepository(dao, pricingQueNoSeUsa, usuarioActual = { USUARIO })
            .guardar(tipo, tienda, prod, pres, valor, Ubicacion(25.6866, -100.3161, 8f), 40, codigoEscaneado = codigoEscaneado)
            .getOrThrow()
        dao.filas.single()
    }

    @Test
    fun `el SKU y el codigo quedan en payloadJson para la lista del telefono`() {
        val escaneada = gson.fromJson(guardar(TipoCaptura.PRECIO_OBSERVADO, 27.5, " 07501000111222 ").payloadJson, ObservacionPayload::class.java)
        assertEquals("FRI-001", escaneada.sku)
        assertEquals("07501000111222", escaneada.codigoBarras)

        // Elegida a mano: el código de la presentación.
        val aMano = gson.fromJson(guardar(TipoCaptura.PRECIO_OBSERVADO, 27.5, null).payloadJson, ObservacionPayload::class.java)
        assertEquals("7501000111222", aMano.codigoBarras)
    }

    @Test
    fun `la captura que viaja es la misma con o sin SKU y codigo en el payload`() {
        listOf(TipoCaptura.PRECIO_OBSERVADO to 27.5, TipoCaptura.DISPONIBILIDAD to 0.0).forEach { (tipo, valor) ->
            val conEscaneo = guardar(tipo, valor, "7501000111222")
            val payload = gson.fromJson(conEscaneo.payloadJson, ObservacionPayload::class.java)
            val sinEscaneo = conEscaneo.copy(payloadJson = gson.toJson(payload.copy(sku = null, codigoBarras = null)))

            val a = aCapturaSync(conEscaneo)!!
            val b = aCapturaSync(sinEscaneo)!!
            assertEquals(b, a)
            assertEquals(gson.toJson(b), gson.toJson(a))
            assertTrue("sin sku en el JSON", !gson.toJson(a).contains("FRI-001"))
            assertTrue("sin código en el JSON", !gson.toJson(a).contains("7501000111222"))
        }
    }

    @Test
    fun `el lote enviado tiene exactamente los campos del contrato, folio y hora intactos`() = runBlocking<Unit> {
        val fila = guardar(TipoCaptura.PRECIO_OBSERVADO, 27.5, "7501000111222")
        val almacen = AlmacenEnMemoria().apply { agregar(fila) }
        val servidor = ServidorFalso().apply { acusar(aceptada()) }
        Sincronizador(
            almacen = almacen,
            enCurso = LoteEnMemoria(),
            cliente = servidor,
            deviceId = "a3b4c5d6-1111-4222-8333-944455556666",
            nuevoId = { "00000000-0000-4000-8000-000000000001" },
            ahora = { OffsetDateTime.of(2026, 10, 30, 9, 2, 0, 0, ZoneOffset.ofHours(-6)) },
        ).sincronizar(USUARIO)

        val lote = servidor.lote(0)
        assertEquals(setOf("batchId", "deviceId", "contractVersion", "client", "sentAt", "captures"), lote.keySet())
        val captura = lote.getAsJsonArray("captures").single().asJsonObject
        assertEquals(setOf("captureId", "type", "contractVersion", "capturedAt", "storeId", "presentationId", "content"), captura.keySet())
        assertEquals(setOf("price", "lat", "lng"), captura.getAsJsonObject("content").keySet())
        assertEquals(fila.captureId, captura["captureId"].asString)
        assertEquals(fila.capturedAt, captura["capturedAt"].asString)
        assertEquals(pres.id, captura["presentationId"].asString)
        assertTrue(!servidor.cuerpos.single().contains("FRI-001"))
        assertTrue(!servidor.cuerpos.single().contains("7501000111222"))
    }
}
