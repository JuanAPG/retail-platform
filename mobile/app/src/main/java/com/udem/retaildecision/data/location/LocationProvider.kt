package com.udem.retaildecision.data.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/** Un punto del mapa tomado con el GPS. */
data class Ubicacion(
    val latitud: Double,
    val longitud: Double,
    /** Qué tan exacta es la lectura, en metros (menos es mejor). Puede no venir. */
    val precisionMetros: Float?,
)

/**
 * Pide la ubicación actual al teléfono (RF-37). Usa el servicio de ubicación de Google Play
 * y, si no logra una lectura nueva, intenta con la última ubicación conocida.
 */
class LocationProvider(context: Context) {

    private val appContext = context.applicationContext
    private val cliente = LocationServices.getFusedLocationProviderClient(appContext)

    fun tienePermiso(): Boolean =
        ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    suspend fun actual(): Result<Ubicacion> {
        if (!tienePermiso()) return Result.failure(Exception("Falta el permiso de ubicación."))
        return try {
            val lectura = withTimeoutOrNull(15_000) { pedirActual() } ?: ultima()
            if (lectura == null) {
                Result.failure(Exception("No se pudo obtener la ubicación. Revisa que el GPS esté encendido y vuelve a intentar."))
            } else {
                Result.success(
                    Ubicacion(
                        latitud = lectura.latitude,
                        longitud = lectura.longitude,
                        precisionMetros = if (lectura.hasAccuracy()) lectura.accuracy else null,
                    ),
                )
            }
        } catch (e: SecurityException) {
            Result.failure(Exception("Falta el permiso de ubicación."))
        } catch (e: Exception) {
            Result.failure(Exception("No se pudo obtener la ubicación."))
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun pedirActual(): Location? = suspendCancellableCoroutine { cont ->
        val cancelar = CancellationTokenSource()
        cont.invokeOnCancellation { cancelar.cancel() }
        cliente.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancelar.token)
            .addOnSuccessListener { if (cont.isActive) cont.resume(it) }
            .addOnFailureListener { if (cont.isActive) cont.resume(null) }
    }

    @SuppressLint("MissingPermission")
    private suspend fun ultima(): Location? = suspendCancellableCoroutine { cont ->
        cliente.lastLocation
            .addOnSuccessListener { if (cont.isActive) cont.resume(it) }
            .addOnFailureListener { if (cont.isActive) cont.resume(null) }
    }
}