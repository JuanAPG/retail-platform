package com.udem.retaildecision.data.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.gson.Gson
import com.udem.retaildecision.data.local.AppDatabase
import com.udem.retaildecision.data.remote.ApiClient
import com.udem.retaildecision.data.remote.mensajeDeError
import com.udem.retaildecision.data.repository.ObservacionPayload
import com.udem.retaildecision.data.repository.aSolicitud
import java.io.IOException

/**
 * RF-40: sincronización al reconectar. WorkManager sobrevive a que la app se cierre y permite
 * pedir "solo con red" (ver SyncScheduler).
 *
 * Manda cada captura pendiente a pricing-service (POST /v1/price-observations). Qué hace según la respuesta:
 *  - 201: la marca como enviada.
 *  - 400/403/404/409 u otro 4xx: el servidor no la va a aceptar por mucho que se reintente; se marca
 *    como procesada y se guarda el motivo para mostrarlo en la lista.
 *  - 401, 429, 5xx o sin red: se deja pendiente y WorkManager reintenta más tarde.
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val dao = AppDatabase.getInstance(applicationContext).pendingVisitDao()
        val pendientes = dao.getUnsynced()
        if (pendientes.isEmpty()) return Result.success()

        val gson = Gson()
        var reintentar = false

        for (fila in pendientes) {
            val payload = runCatching { gson.fromJson(fila.payloadJson, ObservacionPayload::class.java) }.getOrNull()

            // Fila de la versión anterior (visita sin presentación): no hay nada que enviar.
            if (payload == null || payload.presentationId.isBlank()) {
                val marcada = (payload ?: ObservacionPayload()).copy(
                    error = "Registro de una versión anterior de la app; no se puede enviar.",
                )
                dao.update(fila.copy(synced = true, payloadJson = gson.toJson(marcada)))
                continue
            }

            val respuesta = try {
                ApiClient.pricingApi.createObservation(fila.aSolicitud(payload))
            } catch (e: IOException) {
                // Se perdió la red a medio envío: se detiene y se reintenta después.
                reintentar = true
                break
            }

            val codigo = respuesta.code()
            when {
                respuesta.isSuccessful -> {
                    // Se guarda el id que le dio el servidor para poder preguntar después si la aprobaron.
                    val idServidor = respuesta.body()?.id
                    dao.update(fila.copy(synced = true, payloadJson = gson.toJson(payload.copy(serverId = idServidor))))
                }

                codigo == 401 -> {
                    // La sesión no sirve (ApiClient ya avisó a la app). Sin sesión no tiene caso seguir.
                    reintentar = true
                    break
                }

                codigo == 429 || codigo >= 500 -> reintentar = true

                else -> {
                    val motivo = mensajeDeError(respuesta, "El servidor rechazó la captura ($codigo).")
                    dao.update(fila.copy(synced = true, payloadJson = gson.toJson(payload.copy(error = motivo))))
                }
            }
        }

        return if (reintentar) Result.retry() else Result.success()
    }
}