package com.udem.retaildecision.data.sync

import android.content.Context
import android.content.SharedPreferences
import com.udem.retaildecision.data.local.PendingVisitDao
import com.udem.retaildecision.data.local.PendingVisitEntity
import com.udem.retaildecision.data.remote.SyncApi
import com.udem.retaildecision.data.remote.dto.AcuseLoteDto
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import java.util.UUID

/*
 * Conexión del Sincronizador con Android: Room, SharedPreferences y Retrofit.
 * El estado de sincronización va en un archivo de preferencias PROPIO (no en el de la sesión):
 * cerrar sesión borra la sesión, pero no el id del dispositivo ni el lote que espera su acuse.
 */

private const val PREFS_SYNC = "retail_sync"

class AlmacenRoom(private val dao: PendingVisitDao) : AlmacenCapturas {
    override suspend fun pendientesDe(userId: String) = dao.pendientesDe(userId)
    override suspend fun porCaptureIds(captureIds: List<String>) = dao.porCaptureIds(captureIds)
    override suspend fun actualizar(fila: PendingVisitEntity) = dao.update(fila)
}

/** El lote en curso en SharedPreferences, escrito con `commit()` (en disco antes de enviarlo). */
class LoteEnCursoPrefs(context: Context) : GuardaLoteEnCurso {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_SYNC, Context.MODE_PRIVATE)

    override fun leer(): LoteEnCurso? {
        val batchId = prefs.getString(K_BATCH, null) ?: return null
        val userId = prefs.getString(K_USER, null) ?: return null
        val cuerpo = prefs.getString(K_CUERPO, null) ?: return null
        val ids = prefs.getString(K_IDS, null)?.split(',')?.filter { it.isNotBlank() } ?: return null
        return LoteEnCurso(batchId, userId, ids, cuerpo, prefs.getInt(K_409, 0))
    }

    override fun guardar(lote: LoteEnCurso) {
        prefs.edit()
            .putString(K_BATCH, lote.batchId)
            .putString(K_USER, lote.userId)
            .putString(K_IDS, lote.captureIds.joinToString(","))
            .putString(K_CUERPO, lote.cuerpoJson)
            .putInt(K_409, lote.respuestas409)
            .commit()
    }

    override fun borrar() {
        prefs.edit().remove(K_BATCH).remove(K_USER).remove(K_IDS).remove(K_CUERPO).remove(K_409).commit()
    }

    private companion object {
        const val K_BATCH = "lote_batch_id"
        const val K_USER = "lote_user_id"
        const val K_IDS = "lote_capture_ids"
        const val K_CUERPO = "lote_cuerpo"
        const val K_409 = "lote_respuestas_409"
    }
}

/** `deviceId` del contrato (§3): UUID generado la primera vez que se usa y que no cambia. */
object IdentidadDispositivo {
    private const val K_DEVICE = "device_id"

    @Synchronized
    fun deviceId(context: Context): String {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_SYNC, Context.MODE_PRIVATE)
        prefs.getString(K_DEVICE, null)?.let { return it }
        val nuevo = UUID.randomUUID().toString()
        prefs.edit().putString(K_DEVICE, nuevo).commit()
        return nuevo
    }
}

class ClienteSyncRetrofit(private val api: SyncApi) : ClienteSync {
    private val json = "application/json; charset=utf-8".toMediaType()

    override suspend fun enviar(cuerpoJson: String): Response<AcuseLoteDto> =
        api.enviarLote(cuerpoJson.toRequestBody(json), UUID.randomUUID().toString())
}
