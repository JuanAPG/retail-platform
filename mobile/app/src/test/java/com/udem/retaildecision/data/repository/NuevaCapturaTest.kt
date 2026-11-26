package com.udem.retaildecision.data.repository

import com.udem.retaildecision.data.local.EstadoSync
import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.sync.aCapturaSync
import com.udem.retaildecision.data.sync.aplicarResultado
import com.udem.retaildecision.data.remote.dto.MotivoSyncDto
import com.udem.retaildecision.data.remote.dto.ResultadoCapturaDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.UUID

/** Folio y hora de la captura (D-42, contrato §3) y estado que se muestra en la lista. */
class NuevaCapturaTest {

    /** La misma expresión que usa offline-sync-service (`ISO_CON_ZONA` en reglas.ts). */
    private val isoConZona = Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$""")
    private val uuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

    /** 2026-10-26T15:30:00Z */
    private val instante = 1_793_028_600_000L

    private fun nueva(zona: ZoneId = ZoneId.of("America/Monterrey"), tipo: String = TipoCaptura.PRECIO_OBSERVADO) = nuevaCaptura(
        tipo = tipo,
        userId = "u-1",
        storeId = "27f05c81-c6bf-456a-a273-150e4edb9900",
        latitud = 25.6866,
        longitud = -100.3161,
        payload = ObservacionPayload(presentationId = UUID.randomUUID().toString(), price = 27.5, stock = if (tipo == TipoCaptura.DISPONIBILIDAD) 3.0 else null),
        ahoraMillis = instante,
        zona = zona,
    )

    @Test
    fun `la hora de captura lleva zona horaria y segundos, como exige el contrato`() {
        val monterrey = nueva(ZoneId.of("America/Monterrey"))
        assertEquals("2026-10-26T09:30:00-06:00", monterrey.capturedAt)
        assertTrue(isoConZona.matches(monterrey.capturedAt))

        val utc = nueva(ZoneId.of("UTC"))
        assertEquals("2026-10-26T15:30:00Z", utc.capturedAt)
        assertTrue(isoConZona.matches(utc.capturedAt))
    }

    @Test
    fun `cada captura nace con su propio folio UUID y sin enviar`() {
        val a = nueva()
        val b = nueva()
        assertTrue(uuid.matches(a.captureId))
        assertNotEquals(a.captureId, b.captureId)
        assertEquals(EstadoSync.PENDIENTE, a.estadoSync)
        assertEquals(false, a.synced)
        assertEquals("u-1", a.userId)
    }

    @Test
    fun `el folio y la hora no cambian al armar la captura una y otra vez`() {
        val fila = nueva()
        val primera = aCapturaSync(fila)!!
        val segunda = aCapturaSync(fila)!!
        assertEquals(primera, segunda)
        assertEquals(fila.captureId, primera.captureId)
        assertEquals(fila.capturedAt, primera.capturedAt)
    }

    @Test
    fun `un rechazo reintentable conserva el folio y la fila sigue pendiente`() {
        val fila = nueva()
        val tras = aplicarResultado(
            fila,
            ResultadoCapturaDto(captureId = fila.captureId, status = "rechazada", reason = MotivoSyncDto("SERVICE_UNAVAILABLE", "No respondió."), retryable = true),
        )
        assertEquals(fila.captureId, tras.captureId)
        assertEquals(fila.capturedAt, tras.capturedAt)
        assertEquals(fila.payloadJson, tras.payloadJson)
        assertEquals(false, tras.synced)
    }

    @Test
    fun `disponibilidad - solo stock en el contenido`() {
        val c = aCapturaSync(nueva(tipo = TipoCaptura.DISPONIBILIDAD))!!
        assertEquals(3.0, c.content.stock!!, 0.0)
        assertNull(c.content.price)
        assertNull(c.content.lat)
        assertNull(c.content.lng)
    }

    @Test
    fun `un status desconocido no cambia la fila`() {
        val fila = nueva()
        assertEquals(fila, aplicarResultado(fila, ResultadoCapturaDto(captureId = fila.captureId, status = "procesando")))
    }

    @Test
    fun `estado visible - precio aprobado o rechazado por el Responsable de precios`() {
        val enviada = nueva().copy(synced = true, estadoSync = EstadoSync.ACEPTADA)
        val payload = ObservacionPayload(presentationId = "p", price = 10.0)
        assertEquals(EstadoCaptura.ENVIADA, estadoVisible(enviada, payload).first)
        assertEquals(EstadoCaptura.APROBADA, estadoVisible(enviada, payload.copy(decision = "aprobado")).first)
        val (estado, motivo) = estadoVisible(enviada, payload.copy(decision = "rechazado", motivoDecision = "Precio fuera de rango"))
        assertEquals(EstadoCaptura.RECHAZADA, estado)
        assertEquals("Precio fuera de rango", motivo)
    }

    @Test
    fun `estado visible - filas migradas de la versión 1`() {
        val payloadConError = ObservacionPayload(presentationId = "p", price = 10.0, error = "La presentación no existe.")
        val rechazada = nueva().copy(synced = true, estadoSync = EstadoSync.RECHAZADA)
        assertEquals(EstadoCaptura.NO_ACEPTADA to "La presentación no existe.", estadoVisible(rechazada, payloadConError))
        assertEquals(EstadoCaptura.NO_ACEPTADA, estadoVisible(rechazada, ObservacionPayload(presentationId = "")).first)
    }
}
