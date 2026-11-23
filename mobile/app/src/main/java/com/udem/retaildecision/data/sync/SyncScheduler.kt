package com.udem.retaildecision.data.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/** Pide a WorkManager que corra el SyncWorker en cuanto haya internet. Es seguro llamarlo varias veces. */
object SyncScheduler {

    private const val NOMBRE = "sync_precios_observados"

    fun programar(context: Context) {
        val solicitud = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        // APPEND_OR_REPLACE: si ya hay un envío corriendo, este va después y no se pierde lo recién guardado.
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(NOMBRE, ExistingWorkPolicy.APPEND_OR_REPLACE, solicitud)
    }
}