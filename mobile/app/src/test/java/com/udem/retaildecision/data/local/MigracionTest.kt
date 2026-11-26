package com.udem.retaildecision.data.local

import com.google.gson.Gson
import com.udem.retaildecision.data.repository.ObservacionPayload
import com.udem.retaildecision.data.sync.aCapturaSync
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File
import java.sql.Connection
import java.sql.DriverManager
import java.sql.SQLException

/**
 * Migración de Room 1 → 2 (`Migraciones.SQL_1_2`) contra SQLite real (sqlite-jdbc), sin emulador.
 *
 * 1. Crea la tabla como la creaba la versión 1 de la app y le mete filas como las guardaba.
 * 2. Corre la migración.
 * 3. Revisa que no se perdió nada y que cada fila recibió su folio.
 * 4. Compara la tabla migrada con la que Room espera para la versión 2, leyendo el SQL que Room
 *    generó al compilar (AppDatabase_Impl.java). Si no coinciden, Room no abriría la base en el
 *    teléfono ("Migration didn't properly handle pending_visits").
 */
class MigracionTest {

    /** Lo que Room generaba para la entidad de la versión 1 (commit anterior a esta tarea). */
    private val tablaV1 = "CREATE TABLE IF NOT EXISTS `pending_visits` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
        "`storeId` TEXT NOT NULL, `latitude` REAL NOT NULL, `longitude` REAL NOT NULL, `payloadJson` TEXT NOT NULL, " +
        "`createdAtEpochMillis` INTEGER NOT NULL, `synced` INTEGER NOT NULL)"

    private val gson = Gson()
    private lateinit var db: Connection

    @Before
    fun abrir() {
        db = DriverManager.getConnection("jdbc:sqlite::memory:")
    }

    @After
    fun cerrar() = db.close()

    private fun exec(sql: String) = db.createStatement().use { it.execute(sql) }

    private fun filas(sql: String): List<Map<String, Any?>> = db.createStatement().use { st ->
        st.executeQuery(sql).use { rs ->
            val cols = (1..rs.metaData.columnCount).map { rs.metaData.getColumnName(it) }
            buildList { while (rs.next()) add(cols.associateWith { rs.getObject(it) }) }
        }
    }

    private fun insertarV1(id: Int, payload: Any, synced: Boolean, creada: Long) = exec(
        "INSERT INTO pending_visits (id, storeId, latitude, longitude, payloadJson, createdAtEpochMillis, synced) VALUES " +
            "($id, '27f05c81-c6bf-456a-a273-150e4edb9900', 25.6866, -100.3161, '${gson.toJson(payload).replace("'", "''")}', $creada, ${if (synced) 1 else 0})",
    )

    /** 2026-10-26T15:30:00Z */
    private val creada = 1_793_028_600_000L

    private fun prepararV1() {
        exec(tablaV1)
        // Pendiente de enviar (versión 1: precio observado).
        insertarV1(1, ObservacionPayload(presentationId = "5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77", price = 27.5, storeName = "Tienda"), false, creada)
        // Ya enviada a pricing-service y aceptada (con su id en pricing).
        insertarV1(2, ObservacionPayload(presentationId = "5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77", price = 30.0, serverId = "obs-1"), true, creada + 1000)
        // Pricing la rechazó: la versión 1 guardaba el motivo en `error`.
        insertarV1(3, ObservacionPayload(presentationId = "5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77", price = 1.0, error = "La presentación no existe."), true, creada + 2000)
        // "Visita" de la primera versión, sin presentación y sin enviar.
        insertarV1(4, mapOf("nota" to "visita vieja"), false, creada + 3000)
    }

    private fun migrar() = Migraciones.SQL_1_2.forEach(::exec)

    @Test
    fun `no se pierde ninguna fila ni ningún dato que ya estaba`() {
        prepararV1()
        val antes = filas("SELECT id, storeId, latitude, longitude, payloadJson, createdAtEpochMillis, synced FROM pending_visits ORDER BY id")

        migrar()

        val despues = filas("SELECT id, storeId, latitude, longitude, payloadJson, createdAtEpochMillis, synced FROM pending_visits ORDER BY id")
        assertEquals(4, despues.size)
        assertEquals(antes, despues)
    }

    @Test
    fun `cada fila recibe un folio UUID único y su hora con zona horaria`() {
        prepararV1()
        migrar()

        val rows = filas("SELECT id, captureId, capturedAt, tipo, userId FROM pending_visits ORDER BY id")
        val uuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        rows.forEach { assertTrue("UUID v4: ${it["captureId"]}", uuid.matches(it["captureId"] as String)) }
        assertEquals(4, rows.map { it["captureId"] }.toSet().size)
        assertEquals("2026-10-26T15:30:00Z", rows[0]["capturedAt"])
        assertEquals("2026-10-26T15:30:01Z", rows[1]["capturedAt"])
        assertTrue(rows.all { it["tipo"] == "precio_observado" })
        assertTrue("Las filas viejas no tienen dueño", rows.all { it["userId"] == null })
    }

    @Test
    fun `el folio queda protegido por un índice único`() {
        prepararV1()
        migrar()
        val folio = filas("SELECT captureId FROM pending_visits WHERE id = 1")[0]["captureId"]
        try {
            exec("UPDATE pending_visits SET captureId = '$folio' WHERE id = 2")
            fail("Dos filas con el mismo folio deberían rechazarse")
        } catch (e: SQLException) {
            assertTrue(e.message!!.contains("UNIQUE"))
        }
    }

    @Test
    fun `estado de las filas anteriores - pendientes siguen pendientes, lo enviado queda resuelto`() {
        prepararV1()
        migrar()
        val rows = filas("SELECT id, synced, estadoSync, destinoServicio, reintentable FROM pending_visits ORDER BY id").associateBy { it["id"] }

        assertEquals("pendiente", rows[1]!!["estadoSync"]); assertNull(rows[1]!!["destinoServicio"])
        assertEquals("aceptada", rows[2]!!["estadoSync"]); assertEquals("pricing-service", rows[2]!!["destinoServicio"])
        assertEquals("rechazada", rows[3]!!["estadoSync"]); assertNull(rows[3]!!["destinoServicio"])
        assertEquals("pendiente", rows[4]!!["estadoSync"])
        assertTrue(rows.values.all { (it["reintentable"] as Number).toInt() == 0 })
    }

    @Test
    fun `una pendiente migrada se puede armar como captura del contrato`() {
        prepararV1()
        migrar()
        val r = filas("SELECT * FROM pending_visits WHERE id = 1")[0]
        val fila = PendingVisitEntity(
            id = (r["id"] as Number).toLong(),
            storeId = r["storeId"] as String,
            latitude = (r["latitude"] as Number).toDouble(),
            longitude = (r["longitude"] as Number).toDouble(),
            payloadJson = r["payloadJson"] as String,
            createdAtEpochMillis = (r["createdAtEpochMillis"] as Number).toLong(),
            synced = (r["synced"] as Number).toInt() == 1,
            captureId = r["captureId"] as String,
            tipo = r["tipo"] as String,
            capturedAt = r["capturedAt"] as String,
        )
        val captura = aCapturaSync(fila)!!
        assertEquals(fila.captureId, captura.captureId)
        assertEquals("2026-10-26T15:30:00Z", captura.capturedAt)
        assertEquals(27.5, captura.content.price!!, 0.0)

        // La "visita" vieja sin presentación no se puede armar: el Sincronizador la marca rechazada.
        val vieja = filas("SELECT payloadJson FROM pending_visits WHERE id = 4")[0]["payloadJson"] as String
        assertNull(aCapturaSync(fila.copy(payloadJson = vieja)))
    }

    // ---------------------------------------------------------------------------------------
    // La tabla migrada es exactamente la que Room espera en la versión 2
    // ---------------------------------------------------------------------------------------

    /** Lee de AppDatabase_Impl.java (generado por KSP) las sentencias con que Room crea la versión 2. */
    private fun sqlGeneradoPorRoom(): List<String> {
        val candidatos = listOf("debug", "release").map {
            File("build/generated/ksp/$it/java/com/udem/retaildecision/data/local/AppDatabase_Impl.java")
        }
        val archivo = candidatos.firstOrNull { it.exists() }
            ?: error("No encontré AppDatabase_Impl.java en build/generated/ksp: compila antes de correr las pruebas.")
        return Regex("""db\.execSQL\("((?:CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX)[^"]*`pending_visits`[^"]*)"\)""")
            .findAll(archivo.readText()).map { it.groupValues[1].replace("\\\"", "\"") }.toList()
            .also { assertTrue("Room debe generar la tabla y su índice", it.size >= 2) }
    }

    private fun columnas(c: Connection, tabla: String) = c.createStatement().use { st ->
        st.executeQuery("PRAGMA table_info($tabla)").use { rs ->
            buildList {
                while (rs.next()) add(listOf(rs.getString("name"), rs.getString("type"), rs.getInt("notnull"), rs.getInt("pk")))
            }.sortedBy { it[0] as String }
        }
    }

    private fun indices(c: Connection, tabla: String) = c.createStatement().use { st ->
        st.executeQuery("PRAGMA index_list($tabla)").use { rs ->
            buildList { while (rs.next()) if (rs.getString("origin") == "c") add(rs.getString("name") to rs.getInt("unique")) }
        }.map { (nombre, unico) ->
            val cols = c.createStatement().use { s2 ->
                s2.executeQuery("PRAGMA index_info($nombre)").use { r -> buildList { while (r.next()) add(r.getString("name")) } }
            }
            Triple(nombre, unico, cols)
        }.sortedBy { it.first }
    }

    @Test
    fun `la tabla migrada coincide con la que Room crea para la versión 2`() {
        prepararV1()
        migrar()

        DriverManager.getConnection("jdbc:sqlite::memory:").use { limpia ->
            sqlGeneradoPorRoom().forEach { sql -> limpia.createStatement().use { it.execute(sql) } }

            // Room compara nombre, tipo, NOT NULL y llave primaria (el DEFAULT solo si la entidad lo declara).
            assertEquals(columnas(limpia, "pending_visits"), columnas(db, "pending_visits"))
            assertEquals(indices(limpia, "pending_visits"), indices(db, "pending_visits"))
            assertFalse(indices(db, "pending_visits").isEmpty())
        }
    }
}
