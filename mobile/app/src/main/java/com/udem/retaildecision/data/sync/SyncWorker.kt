package com.udem.retaildecision.data.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.udem.retaildecision.RetailDecisionApp
import com.udem.retaildecision.data.local.AppDatabase
import com.udem.retaildecision.data.remote.ApiClient

/**
 * RF-40: sincronización al reconectar. WorkManager sobrevive a que la app se cierre y permite
 * pedir "solo con red" (ver SyncScheduler).
 *
 * Manda las capturas pendientes en LOTES a offline-sync-service (POST /v1/sync/batches, D-42) y
 * guarda el acuse de cada una. Las reglas por estado y por código HTTP están en `Sincronizador`:
 *  - aceptada / duplicada: enviada. conflicto: queda con su motivo, no se reintenta.
 *  - rechazada reintentable: sigue pendiente. rechazada definitiva: queda con su motivo.
 *  - 401, 429, 5xx o sin red: el lote entero sigue pendiente, con los mismos folios, y aquí se
 *    devuelve `retry()` para que WorkManager lo vuelva a intentar con espera exponencial.
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        // Sin sesión no hay token con qué enviar. Al iniciar sesión se vuelve a programar el envío.
        val userId = (applicationContext as RetailDecisionApp).tokenManager.getUserId() ?: return Result.success()

        val sincronizador = Sincronizador(
            almacen = AlmacenRoom(AppDatabase.getInstance(applicationContext).pendingVisitDao()),
            enCurso = LoteEnCursoPrefs(applicationContext),
            cliente = ClienteSyncRetrofit(ApiClient.syncApi),
            deviceId = IdentidadDispositivo.deviceId(applicationContext),
        )
        return when (sincronizador.sincronizar(userId)) {
            ResultadoSync.LISTO -> Result.success()
            ResultadoSync.REINTENTAR -> Result.retry()
        }
    }
}
