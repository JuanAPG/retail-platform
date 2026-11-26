package com.udem.retaildecision.data.sync

import com.udem.retaildecision.data.local.EstadoSync
import com.udem.retaildecision.data.repository.EstadoCaptura
import com.udem.retaildecision.data.repository.ObservacionPayload
import com.udem.retaildecision.data.repository.estadoVisible
import com.google.gson.Gson
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.OffsetDateTime
import java.time.ZoneOffset

/**
 * Reglas del envío a offline-sync-service (contrato §4, D-42) con la base, el lote en curso y el
 * servidor en memoria. Cada prueba dice qué regla de la tarea cubre.
 */
class SincronizadorTest {

    private lateinit var almacen: AlmacenEnMemoria
    private lateinit var enCurso: LoteEnMemoria
    private lateinit var servidor: ServidorFalso
    private var ids = 0

    private fun sincronizador(tamano: Int = TAMANO_LOTE) = Sincronizador(
        almacen = almacen,
        enCurso = enCurso,
        cliente = servidor,
        deviceId = "a3b4c5d6-1111-4222-8333-944455556666",
        nuevoId = { "00000000-0000-4000-8000-%012d".format(++ids) },
        ahora = { OffsetDateTime.of(2026, 10, 30, 9, 2, 0, 0, ZoneOffset.ofHours(-6)) },
        tamanoLote = tamano,
    )

    private fun sincronizar(tamano: Int = TAMANO_LOTE) = runBlocking { sincronizador(tamano).sincronizar(USUARIO) }

    private fun visible(captureId: String): EstadoCaptura {
        val f = almacen.fila(captureId)
        return estadoVisible(f, Gson().fromJson(f.payloadJson, ObservacionPayload::class.java)).first
    }

    @Before
    fun preparar() {
        almacen = AlmacenEnMemoria()
        enCurso = LoteEnMemoria()
        servidor = ServidorFalso()
    }

    // ---------------------------------------------------------------------------------------
    // Formato del lote (contrato §4.1, §4.3)
    // ---------------------------------------------------------------------------------------

    @Test
    fun `el lote JSON lleva solo los campos del contrato`() {
        val p = precio(27.5)
        val d = existencia(0.0)
        almacen.agregar(p, d)
        servidor.acusar(aceptada(), aceptada("availability-service"))

        sincronizar()

        val lote = servidor.lote(0)
        assertEquals(setOf("batchId", "deviceId", "contractVersion", "client", "sentAt", "captures"), lote.keySet())
        assertEquals("1.0", lote["contractVersion"].asString)
        assertEquals("movil", lote["client"].asString)
        assertEquals("2026-10-30T09:02:00-06:00", lote["sentAt"].asString)

        val (cp, cd) = lote.getAsJsonArray("captures").map { it.asJsonObject }
        assertEquals(setOf("captureId", "type", "contractVersion", "capturedAt", "storeId", "presentationId", "content"), cp.keySet())
        assertEquals(p.captureId, cp["captureId"].asString)
        assertEquals("precio_observado", cp["type"].asString)
        assertEquals("2026-10-26T09:30:00-06:00", cp["capturedAt"].asString)
        // Precio: price y la ubicación juntas, sin stock.
        assertEquals(setOf("price", "lat", "lng"), cp.getAsJsonObject("content").keySet())
        assertEquals(27.5, cp.getAsJsonObject("content")["price"].asDouble, 0.0)
        // Disponibilidad: solo stock (el contrato rechaza lat/lng en este tipo). 0 = agotado se manda.
        assertEquals("disponibilidad", cd["type"].asString)
        assertEquals(setOf("stock"), cd.getAsJsonObject("content").keySet())
        assertEquals(0.0, cd.getAsJsonObject("content")["stock"].asDouble, 0.0)
    }

    // ---------------------------------------------------------------------------------------
    // Acuse por captura (D-42): cada estado
    // ---------------------------------------------------------------------------------------

    @Test
    fun `lote mixto - cada estado del acuse queda en su fila`() {
        val a = precio()
        val dup = precio()
        val conf = existencia()
        val reint = precio()
        // Válida en el teléfono, pero el servidor la rechaza (p. ej. presentación inexistente).
        val defValida = precio()
        almacen.agregar(a, dup, conf, reint)
        almacen.agregar(defValida)
        servidor.acusar(
            aceptada(),
            duplicada("aceptada"),
            conflicto(),
            rechazada("pricing-service no respondió en 3 s. Reintenta el lote.", reintentable = true, code = "SERVICE_UNAVAILABLE"),
            rechazada("La presentación no existe.", reintentable = false),
        )

        val r = sincronizar()

        // Queda una reintentable: WorkManager debe volver a intentar.
        assertEquals(ResultadoSync.REINTENTAR, r)
        assertNull("El lote ya tuvo su acuse: no queda en curso", enCurso.lote)

        // aceptada → enviada, con el id que le dio el destino.
        with(almacen.fila(a.captureId)) {
            assertTrue(synced); assertEquals(EstadoSync.ACEPTADA, estadoSync)
            assertEquals("pricing-service", destinoServicio); assertEquals("destino-${a.captureId}", destinoId)
        }
        assertEquals(EstadoCaptura.ENVIADA, visible(a.captureId))

        // duplicada (de una aceptada) → enviada.
        with(almacen.fila(dup.captureId)) {
            assertTrue(synced); assertEquals(EstadoSync.DUPLICADA, estadoSync); assertEquals("aceptada", estadoOriginal)
        }
        assertEquals(EstadoCaptura.ENVIADA, visible(dup.captureId))

        // conflicto → no se reintenta, con su motivo y cuándo se capturó el dato que ganó.
        with(almacen.fila(conf.captureId)) {
            assertTrue(synced); assertFalse(reintentable); assertEquals(EstadoSync.CONFLICTO, estadoSync)
            assertEquals("CONFLICT", motivoCodigo); assertNotNull(motivoMensaje)
            assertEquals("2026-10-28T16:00:00.000Z", serverCapturedAt)
        }
        assertEquals(EstadoCaptura.CONFLICTO, visible(conf.captureId))

        // rechazada reintentable → sigue pendiente, con su motivo.
        with(almacen.fila(reint.captureId)) {
            assertFalse(synced); assertTrue(reintentable); assertEquals(EstadoSync.RECHAZADA, estadoSync)
            assertEquals("SERVICE_UNAVAILABLE", motivoCodigo)
        }
        assertEquals(EstadoCaptura.REINTENTO, visible(reint.captureId))

        // rechazada definitiva → resuelta, con el motivo para mostrarlo.
        with(almacen.fila(defValida.captureId)) {
            assertTrue(synced); assertFalse(reintentable); assertEquals("La presentación no existe.", motivoMensaje)
        }
        assertEquals(EstadoCaptura.NO_ACEPTADA, visible(defValida.captureId))

        // Cada captura se mandó una sola vez en la corrida (la reintentable espera a WorkManager).
        assertEquals(1, servidor.cuerpos.size)
    }

    @Test
    fun `todas aceptadas - la corrida termina en LISTO`() {
        almacen.agregar(precio(), existencia())
        servidor.acusar(aceptada(), aceptada("availability-service"))

        assertEquals(ResultadoSync.LISTO, sincronizar())
        assertTrue(almacen.filas.values.all { it.synced })
    }

    @Test
    fun `duplicada de un conflicto o de un rechazo se muestra como lo que fue la primera vez`() {
        val c = precio()
        val r = precio()
        almacen.agregar(c, r)
        servidor.acusar(duplicada("conflicto", "Había un dato más reciente."), duplicada("rechazada", "La presentación no existe."))

        sincronizar()

        assertEquals(EstadoCaptura.CONFLICTO, visible(c.captureId))
        assertEquals("Había un dato más reciente.", almacen.fila(c.captureId).motivoMensaje)
        assertEquals(EstadoCaptura.NO_ACEPTADA, visible(r.captureId))
    }

    @Test
    fun `una reintentable se vuelve a mandar con el MISMO folio en un lote nuevo`() {
        val ok = precio()
        val reint = existencia()
        almacen.agregar(ok, reint)
        servidor.acusar(aceptada(), rechazada("availability-service no respondió.", reintentable = true))
        assertEquals(ResultadoSync.REINTENTAR, sincronizar())

        servidor.acusar(aceptada("availability-service"))
        assertEquals(ResultadoSync.LISTO, sincronizar())

        assertEquals(listOf(reint.captureId), servidor.ids(1))
        assertNotEquals("Es otro lote", servidor.lote(0)["batchId"], servidor.lote(1)["batchId"])
        assertTrue(almacen.fila(reint.captureId).synced)
        assertEquals(EstadoCaptura.ENVIADA, visible(reint.captureId))
    }

    // ---------------------------------------------------------------------------------------
    // Códigos HTTP del lote (§4.10): 401, 429, 5xx y sin red → todo sigue pendiente, mismo lote
    // ---------------------------------------------------------------------------------------

    private fun verificaQueTodoSiguePendienteYSeReenviaIgual(primerIntento: ServidorFalso.() -> Unit) {
        val p = precio()
        val d = existencia()
        almacen.agregar(p, d)
        val antes = almacen.filas.values.toList()

        servidor.primerIntento()
        assertEquals(ResultadoSync.REINTENTAR, sincronizar())

        // Nada cambió en la base: mismos folios, nada marcado.
        assertEquals(antes, almacen.filas.values.toList())
        val enEspera = enCurso.lote
        assertNotNull("El lote sigue en curso para reenviarse igual", enEspera)

        // WorkManager reintenta: sale EXACTAMENTE el mismo lote (mismo batchId, mismos bytes).
        servidor.acusar(aceptada(), aceptada("availability-service"))
        assertEquals(ResultadoSync.LISTO, sincronizar())
        assertEquals(2, servidor.cuerpos.size)
        assertEquals(servidor.cuerpos[0], servidor.cuerpos[1])
        assertEquals(listOf(p.captureId, d.captureId), servidor.ids(1))
        assertTrue(almacen.filas.values.all { it.synced })
    }

    @Test
    fun `401 - el lote sigue pendiente y se reenvía igual`() = verificaQueTodoSiguePendienteYSeReenviaIgual { responder(401) }

    @Test
    fun `429 - el lote sigue pendiente y se reenvía igual`() = verificaQueTodoSiguePendienteYSeReenviaIgual { responder(429) }

    @Test
    fun `500 - el lote sigue pendiente y se reenvía igual`() = verificaQueTodoSiguePendienteYSeReenviaIgual { responder(500) }

    @Test
    fun `503 Mongo o Redis caidos - el lote sigue pendiente y se reenvía igual`() =
        verificaQueTodoSiguePendienteYSeReenviaIgual { responder(503, "No se pudo guardar el lote: MongoDB no responde.") }

    @Test
    fun `sin red - el lote sigue pendiente y se reenvía igual`() = verificaQueTodoSiguePendienteYSeReenviaIgual { sinRed() }

    @Test
    fun `200 sin acuse legible - se trata como respuesta perdida`() =
        verificaQueTodoSiguePendienteYSeReenviaIgual { responder { retrofit2.Response.success(null) } }

    @Test
    fun `respuesta perdida - el reenvío recupera el acuse sin repetir nada`() {
        val p = precio()
        val c = existencia()
        almacen.agregar(p, c)
        // El servidor procesó el lote, pero la respuesta no llegó (se cortó la red).
        servidor.sinRed()
        assertEquals(ResultadoSync.REINTENTAR, sincronizar())

        // Reenvío: el servidor reconoce el batchId y contesta todo como duplicada (§4.8).
        servidor.acusar(duplicada("aceptada"), duplicada("conflicto", "Más reciente en el servidor."))
        sincronizar()

        assertEquals(servidor.cuerpos[0], servidor.cuerpos[1])
        assertEquals(EstadoCaptura.ENVIADA, visible(p.captureId))
        assertEquals(EstadoCaptura.CONFLICTO, visible(c.captureId))
    }

    @Test
    fun `el folio no cambia al reintentar varias veces ni al rearmar el lote`() {
        val p = precio()
        almacen.agregar(p)
        val folio = p.captureId
        val hora = p.capturedAt

        servidor.responder(503)
        servidor.sinRed()
        servidor.responder(429)
        repeat(3) { assertEquals(ResultadoSync.REINTENTAR, sincronizar()) }
        // Tres 409 seguidos: el lote se rearma con un batchId nuevo...
        repeat(MAXIMO_409) { servidor.responder(409, "El lote se está procesando; reintenta.") }
        repeat(MAXIMO_409) { sincronizar() }
        servidor.acusar(aceptada())
        sincronizar()

        // ...pero la captura conserva su folio y su hora en todos los envíos.
        assertEquals(7, servidor.cuerpos.size)
        servidor.cuerpos.indices.forEach { i ->
            val captura = servidor.lote(i).getAsJsonArray("captures")[0].asJsonObject
            assertEquals(folio, captura["captureId"].asString)
            assertEquals(hora, captura["capturedAt"].asString)
        }
        assertEquals(folio, almacen.fila(folio).captureId)
        assertTrue(almacen.fila(folio).synced)
    }

    @Test
    fun `409 - reintenta el mismo lote y a los 3 lo rearma con otro batchId`() {
        almacen.agregar(precio())
        servidor.responder(409, "El lote se está procesando; reintenta.")
        servidor.responder(409, "El lote se está procesando; reintenta.")
        assertEquals(ResultadoSync.REINTENTAR, sincronizar())
        assertEquals(ResultadoSync.REINTENTAR, sincronizar())
        assertEquals(servidor.lote(0)["batchId"], servidor.lote(1)["batchId"])
        assertEquals(2, enCurso.lote?.respuestas409)

        servidor.responder(409, "El batchId ya se usó con otro contenido.")
        assertEquals(ResultadoSync.REINTENTAR, sincronizar())
        assertNull("Al tercer 409 se descarta el lote", enCurso.lote)

        servidor.acusar(aceptada())
        assertEquals(ResultadoSync.LISTO, sincronizar())
        assertNotEquals(servidor.lote(0)["batchId"], servidor.lote(3)["batchId"])
        assertEquals(servidor.ids(0), servidor.ids(3))
    }

    // ---------------------------------------------------------------------------------------
    // 4xx definitivos del lote: no se reintenta; cada captura queda con el motivo
    // ---------------------------------------------------------------------------------------

    @Test
    fun `403 - rol sin permiso - las capturas quedan rechazadas con el motivo, no se borran`() {
        val p = precio()
        almacen.agregar(p)
        servidor.responder(403, "Tu rol no puede sincronizar capturas.")

        assertEquals(ResultadoSync.LISTO, sincronizar())

        with(almacen.fila(p.captureId)) {
            assertTrue(synced); assertEquals(EstadoSync.RECHAZADA, estadoSync)
            assertEquals("FORBIDDEN", motivoCodigo); assertEquals("Tu rol no puede sincronizar capturas.", motivoMensaje)
        }
        assertEquals(EstadoCaptura.NO_ACEPTADA, visible(p.captureId))
        assertNull(enCurso.lote)
    }

    @Test
    fun `400 - lote mal formado - rechazadas con el mensaje del servidor`() {
        val p = precio()
        almacen.agregar(p)
        servidor.responder(400, "El lote no es válido.")

        assertEquals(ResultadoSync.LISTO, sincronizar())
        assertEquals("VALIDATION_ERROR", almacen.fila(p.captureId).motivoCodigo)
        assertEquals("El lote no es válido.", almacen.fila(p.captureId).motivoMensaje)
    }

    @Test
    fun `413 - el lote se parte a la mitad sin cambiar folios`() {
        val filas = List(4) { precio() }
        almacen.agregar(*filas.toTypedArray())
        servidor.responder(413, "El lote excede el máximo.")
        servidor.acusar(aceptada(), aceptada())
        servidor.acusar(aceptada(), aceptada())

        assertEquals(ResultadoSync.LISTO, sincronizar())

        assertEquals(filas.map { it.captureId }, servidor.ids(0))
        assertEquals(filas.take(2).map { it.captureId }, servidor.ids(1))
        assertEquals(filas.drop(2).map { it.captureId }, servidor.ids(2))
        assertTrue(almacen.filas.values.all { it.synced })
    }

    @Test
    fun `más de un lote - se manda todo en lotes del tamaño máximo`() {
        val filas = List(5) { precio() }
        almacen.agregar(*filas.toTypedArray())
        servidor.acusar(aceptada(), aceptada())
        servidor.acusar(aceptada(), aceptada())
        servidor.acusar(aceptada())

        assertEquals(ResultadoSync.LISTO, sincronizar(tamano = 2))
        assertEquals(listOf(2, 2, 1), servidor.cuerpos.indices.map { servidor.ids(it).size })
    }

    // ---------------------------------------------------------------------------------------
    // Autor y filas que no se pueden enviar
    // ---------------------------------------------------------------------------------------

    @Test
    fun `solo se envían las capturas de quien tiene la sesión`() {
        val mia = precio()
        val ajena = precio(userId = "otro-usuario")
        val sinDueno = precio(userId = null) // de la versión 1 de la base
        almacen.agregar(mia, ajena, sinDueno)
        servidor.acusar(aceptada(), aceptada())

        sincronizar()

        assertEquals(listOf(mia.captureId, sinDueno.captureId), servidor.ids(0))
        assertFalse(almacen.fila(ajena.captureId).synced)
        assertEquals("La fila sin dueño la adopta quien la envía", USUARIO, almacen.fila(sinDueno.captureId).userId)
    }

    @Test
    fun `un lote en curso de otra sesión no se manda con este token`() {
        enCurso.guardar(LoteEnCurso("lote-ajeno", "otro-usuario", listOf("x"), "{}"))
        val mia = precio()
        almacen.agregar(mia)
        servidor.acusar(aceptada())

        sincronizar()

        assertEquals(1, servidor.cuerpos.size)
        assertEquals(listOf(mia.captureId), servidor.ids(0))
    }

    @Test
    fun `una fila de la primera versión sin presentación no se envía y queda rechazada`() {
        val vieja = fila("precio_observado", ObservacionPayload(presentationId = ""), USUARIO)
        almacen.agregar(vieja)

        assertEquals(ResultadoSync.LISTO, sincronizar())

        assertTrue(servidor.cuerpos.isEmpty())
        assertTrue(almacen.fila(vieja.captureId).synced)
        assertEquals(EstadoCaptura.NO_ACEPTADA, visible(vieja.captureId))
    }

    @Test
    fun `sin pendientes no se llama al servidor`() {
        assertEquals(ResultadoSync.LISTO, sincronizar())
        assertTrue(servidor.cuerpos.isEmpty())
    }
}
