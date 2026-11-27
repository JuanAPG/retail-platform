package com.udem.retaildecision.data.local

import android.content.Context

/**
 * Última tienda en la que cada usuario guardó una captura, para preseleccionarla cuando llega desde el
 * escáner. Se guarda POR USUARIO (`userId`): en un teléfono compartido, otro usuario no ve la tuya.
 * Sin usuario (sesión vacía) no se lee ni se guarda nada.
 *
 * La lectura y escritura del valor se inyectan para poder probar la regla en la JVM; en la app van a un
 * archivo de preferencias propio (no el de la sesión, que se borra al cerrar sesión).
 */
class UltimaTiendaPorUsuario(
    private val leerValor: (clave: String) -> String?,
    private val escribirValor: (clave: String, valor: String) -> Unit,
) {

    fun de(userId: String?): String? {
        val usuario = userId?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return leerValor(clave(usuario))
    }

    fun recordar(userId: String?, tiendaId: String) {
        val usuario = userId?.trim()?.takeIf { it.isNotEmpty() } ?: return
        escribirValor(clave(usuario), tiendaId)
    }

    private fun clave(userId: String) = "ultima_tienda_$userId"

    companion object {
        private const val PREFS = "retail_capturas"

        fun enTelefono(context: Context): UltimaTiendaPorUsuario {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return UltimaTiendaPorUsuario(
                leerValor = { prefs.getString(it, null) },
                escribirValor = { clave, valor -> prefs.edit().putString(clave, valor).apply() },
            )
        }
    }
}
