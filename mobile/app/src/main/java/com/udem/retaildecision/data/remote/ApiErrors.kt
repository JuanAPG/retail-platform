package com.udem.retaildecision.data.remote

import com.google.gson.JsonArray
import com.google.gson.JsonParser
import retrofit2.Response

/**
 * Saca el texto de `message` del error estándar de los servicios
 * ({statusCode, message, code, details, path, timestamp}). Si `message` es una lista
 * (errores de validación) los une. Si no hay cuerpo o no se puede leer, regresa `porDefecto`.
 */
fun mensajeDeError(respuesta: Response<*>, porDefecto: String): String {
    val texto = runCatching { respuesta.errorBody()?.string() }.getOrNull()
    if (texto.isNullOrBlank()) return porDefecto
    return runCatching {
        val mensaje = JsonParser.parseString(texto).asJsonObject.get("message")
        when {
            mensaje == null || mensaje.isJsonNull -> porDefecto
            mensaje.isJsonArray -> (mensaje as JsonArray).joinToString(" ") { it.asString }
            else -> mensaje.asString
        }
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: porDefecto
}