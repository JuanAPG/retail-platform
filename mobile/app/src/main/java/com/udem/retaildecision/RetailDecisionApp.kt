package com.udem.retaildecision

import android.app.Application
import com.udem.retaildecision.data.local.TokenManager
import com.udem.retaildecision.data.remote.ApiClient

/**
 * Application: se crea UNA sola vez, antes que cualquier Activity, y vive
 * mientras la app esté en memoria. La usamos para inicializar cosas que
 * necesitan Context y que se comparten entre pantallas (en vez de crearlas
 * de nuevo en cada Activity): el TokenManager (guarda el JWT cifrado) y el
 * ApiClient (instancia única de Retrofit).
 *
 * Esto evita, por ejemplo, tener 3 instancias distintas de OkHttp abriendo
 * conexiones por separado, o leer el token de disco en cada pantalla.
 */
class RetailDecisionApp : Application() {

    lateinit var tokenManager: TokenManager
        private set

    override fun onCreate() {
        super.onCreate()
        tokenManager = TokenManager(applicationContext)
        // ApiClient es un singleton basado en objeto Kotlin (ver ApiClient.kt),
        // pero necesita saber de dónde leer el token para el interceptor de
        // Authorization. Se lo inyectamos aquí, una sola vez.
        ApiClient.init(tokenManager)
    }
}
