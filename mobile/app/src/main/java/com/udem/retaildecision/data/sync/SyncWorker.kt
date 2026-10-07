package com.udem.retaildecision.data.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.udem.retaildecision.data.local.AppDatabase

/**
 * RF-39: sincronización automática al reconectar. WorkManager (no un Thread
 * manual) porque WorkManager sobrevive a que la app se cierre o el sistema
 * la mate, y permite poner la condición "solo correr si hay red" de forma
 * declarativa (ver NetworkType.CONNECTED en la clase que lo agenda, pendiente
 * de crear junto con la pantalla de visitas).
 *
 * Por ahora el worker solo recorre lo pendiente y lo marca — el POST real a
 * core-process-service se conecta en cuanto definamos el endpoint exacto de
 * "registrar visita" con el equipo.
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val dao = AppDatabase.getInstance(applicationContext).pendingVisitDao()
        val pending = dao.getUnsynced()

        if (pending.isEmpty()) return Result.success()

        return try {
            for (visit in pending) {
                // TODO: reemplazar por la llamada real, ej.
                // val response = ApiClient.coreProcessApi.registerVisit(visit.toDto())
                // if (response.isSuccessful) dao.update(visit.copy(synced = true))
            }
            Result.success()
        } catch (e: Exception) {
            // Si falla (ej. se perdió la conexión de nuevo a medio sync),
            // WorkManager reintenta solo más tarde gracias a Result.retry().
            Result.retry()
        }
    }
}
