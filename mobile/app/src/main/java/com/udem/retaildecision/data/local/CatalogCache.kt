package com.udem.retaildecision.data.local

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.File

/**
 * Copia en el teléfono de las listas que la captura en campo necesita (tiendas y productos), para
 * poder elegirlas aunque no haya internet. Se guarda como JSON en la carpeta privada de la app y
 * se reemplaza cada vez que el servidor responde bien.
 */
class CatalogCache(context: Context) {

    private val gson = Gson()
    private val carpeta = context.applicationContext.filesDir

    fun <T> guardar(clave: String, lista: List<T>) {
        runCatching { archivo(clave).writeText(gson.toJson(lista)) }
    }

    fun <T> leer(clave: String, tipo: Class<T>): List<T>? = runCatching {
        val archivo = archivo(clave)
        if (!archivo.exists()) return null
        val tipoLista = TypeToken.getParameterized(List::class.java, tipo).type
        gson.fromJson<List<T>>(archivo.readText(), tipoLista)
    }.getOrNull()

    private fun archivo(clave: String) = File(carpeta, "cache_$clave.json")
}