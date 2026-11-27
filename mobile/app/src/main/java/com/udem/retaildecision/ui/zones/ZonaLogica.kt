package com.udem.retaildecision.ui.zones

import com.udem.retaildecision.data.local.AlmacenListas
import com.udem.retaildecision.data.model.Rol
import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.remote.dto.StoreDireccionDto
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.remote.dto.ZoneClassificationDto
import com.udem.retaildecision.data.remote.dto.ZoneCoverageDto
import com.udem.retaildecision.data.repository.SinConexionException
import java.text.Normalizer
import java.util.Locale

/*
 * Reglas de la pestaña Zonas y del Detalle de zona, sin nada de Android para poder probarlas en la JVM.
 */

// ---------------------------------------------------------------------------------------------
// Qué ve cada rol
// ---------------------------------------------------------------------------------------------

/**
 * - Nivel de ingreso (income-segmentation) y cobertura de básicos (availability): solo los 6 perfiles
 *   internos. Al Investigador de mercado ambos servicios le responden 403 (D-28), así que ni se piden.
 * - "Capturar aquí": solo quien puede mandar capturas (contrato de offline-sync §2).
 */
data class PermisosZona(
    val veIngreso: Boolean,
    val veCobertura: Boolean,
    val puedeCapturar: Boolean,
)

fun permisosZona(rol: String?): PermisosZona = PermisosZona(
    veIngreso = rol in Rol.INTERNOS,
    veCobertura = rol in Rol.INTERNOS,
    puedeCapturar = rol != null && rol in TipoCaptura.ROLES_QUE_SINCRONIZAN,
)

// ---------------------------------------------------------------------------------------------
// Nivel de ingreso
// ---------------------------------------------------------------------------------------------

/** Tono de la insignia. NEUTRO = un segmento que no es bajo, medio ni alto (se muestra su nombre tal cual). */
enum class TonoIngreso { BAJO, MEDIO, ALTO, NEUTRO }

data class NivelIngreso(val etiqueta: String, val tono: TonoIngreso)

private fun normalizar(texto: String): String =
    Normalizer.normalize(texto.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")

/**
 * Nivel de la zona según el segmento de su clasificación vigente. Se lee del nombre ("Ingreso bajo") y,
 * si no lo dice, del código sembrado (ING_1 bajo, ING_2 medio, ING_3 alto). Es un dato de la ZONA
 * agregada (RN-02), nunca de una persona.
 */
fun nivelDeIngreso(clasificacion: ZoneClassificationDto): NivelIngreso {
    val nombre = clasificacion.segmentName?.trim().orEmpty()
    val palabras = normalizar(nombre).split(Regex("[^a-z0-9]+")).toSet()
    val tono = when {
        "bajo" in palabras -> TonoIngreso.BAJO
        "medio" in palabras -> TonoIngreso.MEDIO
        "alto" in palabras -> TonoIngreso.ALTO
        else -> when (clasificacion.segmentCode?.trim()?.uppercase()) {
            "ING_1" -> TonoIngreso.BAJO
            "ING_2" -> TonoIngreso.MEDIO
            "ING_3" -> TonoIngreso.ALTO
            else -> TonoIngreso.NEUTRO
        }
    }
    val etiqueta = when (tono) {
        TonoIngreso.BAJO -> "Ingreso bajo"
        TonoIngreso.MEDIO -> "Ingreso medio"
        TonoIngreso.ALTO -> "Ingreso alto"
        TonoIngreso.NEUTRO -> nombre.ifBlank { clasificacion.segmentCode ?: "Segmento sin nombre" }
    }
    return NivelIngreso(etiqueta, tono)
}

/**
 * Nivel vigente por zona. Si llegara más de una vigente para la misma zona, gana la de `validFrom` más reciente.
 * Vigente = `current` o sin `validTo` (Gson deja `current` en false si el campo no viniera).
 */
fun nivelesPorZona(clasificaciones: List<ZoneClassificationDto>): Map<String, NivelIngreso> =
    clasificaciones.filter { it.current || it.validTo == null }
        .groupBy { it.zoneId }
        .mapValues { (_, lista) -> nivelDeIngreso(lista.maxBy { it.validFrom.orEmpty() }) }

// ---------------------------------------------------------------------------------------------
// Tiendas
// ---------------------------------------------------------------------------------------------

/** Tiendas activas por zona, para la tarjeta de la lista ("4 tiendas"). */
fun tiendasPorZona(tiendas: List<StoreDto>): Map<String, Int> =
    tiendas.filter { it.activo && it.zonaId != null }.groupingBy { it.zonaId!! }.eachCount()

fun textoTiendas(cuantas: Int): String = if (cuantas == 1) "1 tienda" else "$cuantas tiendas"

/** Formato de catalog-service en palabras (contrato: supermercado | minimarket | tienda_conveniencia | mayorista | otro). */
fun formatoLegible(formato: String?): String? = when (formato?.trim()?.lowercase()) {
    null, "" -> null
    "supermercado" -> "Supermercado"
    "minimarket" -> "Minimarket"
    "tienda_conveniencia" -> "Tienda de conveniencia"
    "mayorista" -> "Mayorista"
    "otro" -> "Otro formato"
    else -> formato.replace('_', ' ').trim().replaceFirstChar { it.uppercase() }
}

/** "Av. Constitución 1050, Centro, CP 64000". Lo que falte se omite; sin nada, un texto claro. */
fun direccionLegible(d: StoreDireccionDto?): String {
    if (d == null) return "Sin dirección registrada"
    val calle = listOfNotNull(d.calle?.trim(), d.numeroExterior?.trim()).filter { it.isNotEmpty() }.joinToString(" ")
    val cp = d.codigoPostal?.trim()?.takeIf { it.isNotEmpty() }?.let { "CP $it" }
    return listOfNotNull(calle.takeIf { it.isNotEmpty() }, d.colonia?.trim()?.takeIf { it.isNotEmpty() }, cp)
        .joinToString(", ")
        .ifBlank { "Sin dirección registrada" }
}

/** Latitud y longitud de la tienda, solo si vienen las dos y son válidas. Sin ellas no hay botón "Ver en mapa". */
fun coordenadas(tienda: StoreDto): Pair<Double, Double>? {
    val lat = tienda.direccion?.latitud?.trim()?.toDoubleOrNull() ?: return null
    val lon = tienda.direccion.longitud?.trim()?.toDoubleOrNull() ?: return null
    if (lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
    return lat to lon
}

/** URI para abrir la app de mapas con un pin en la tienda. */
fun uriMapa(tienda: StoreDto): String? {
    val (lat, lon) = coordenadas(tienda) ?: return null
    val punto = String.format(Locale.US, "%.6f,%.6f", lat, lon)
    val etiqueta = java.net.URLEncoder.encode(tienda.nombre, "UTF-8").replace("+", "%20")
    return "geo:$punto?q=$punto($etiqueta)"
}

// ---------------------------------------------------------------------------------------------
// Indicadores que vienen de otros servicios (ingreso y cobertura)
// ---------------------------------------------------------------------------------------------

/** Un dato de la zona que puede no mostrarse. */
sealed interface Indicador<out T> {
    /** El rol no lo ve: no se pide ni se pinta nada. */
    data object Oculto : Indicador<Nothing>

    data object Cargando : Indicador<Nothing>

    data class Listo<T>(val valor: T) : Indicador<T>

    /** No hay valor que mostrar; el texto explica por qué ("Sin datos vigentes", "No disponible sin conexión"). */
    data class Aviso(val texto: String) : Indicador<Nothing>
}

const val SIN_CONEXION = "No disponible sin conexión"
const val NO_DISPONIBLE = "No disponible por ahora"
const val SIN_DATOS_VIGENTES = "Sin datos vigentes"
const val SIN_CLASIFICACION = "Sin clasificación vigente"

fun avisoDeFalla(e: Throwable?): Indicador.Aviso =
    Indicador.Aviso(if (e is SinConexionException) SIN_CONEXION else NO_DISPONIBLE)

/** "75 %", "66.67 %". `disponible: false` (o sin número) es "Sin datos vigentes": nunca 0 %. */
fun indicadorCobertura(c: ZoneCoverageDto): Indicador<String> {
    val valor = c.coverage
    if (!c.disponible || valor == null || valor.isNaN() || valor.isInfinite()) return Indicador.Aviso(SIN_DATOS_VIGENTES)
    val texto = if (valor % 1.0 == 0.0) valor.toLong().toString() else String.format(Locale.US, "%.2f", valor).trimEnd('0')
    return Indicador.Listo("$texto %")
}

// ---------------------------------------------------------------------------------------------
// Detalle de zona
// ---------------------------------------------------------------------------------------------

data class DetalleZona(
    /** null = no hubo red ni copia guardada. */
    val tiendas: List<StoreDto>?,
    /** true si las tiendas salieron de la copia del teléfono. */
    val tiendasDesdeCopia: Boolean,
    val errorTiendas: String?,
    val ingreso: Indicador<NivelIngreso>,
    val cobertura: Indicador<String>,
)

fun claveTiendasDeZona(zonaId: String) = "tiendas_zona_$zonaId"

/**
 * Arma el detalle de una zona. Nunca lanza: cada parte que falla se reemplaza por su aviso, y la lista de
 * tiendas usa la copia del teléfono si no hay red (primero la de la zona; si no, la lista general filtrada).
 */
class CargadorDetalleZona(
    private val permisos: PermisosZona,
    private val tiendasRemotas: suspend (zonaId: String) -> Result<List<StoreDto>>,
    private val pedirClasificacion: suspend (zonaId: String) -> Result<ZoneClassificationDto?>,
    private val pedirCobertura: suspend (zonaId: String) -> Result<ZoneCoverageDto>,
    private val cache: AlmacenListas,
) {

    suspend fun tiendas(zonaId: String): Triple<List<StoreDto>?, Boolean, String?> {
        val remoto = runCatching { tiendasRemotas(zonaId) }.getOrElse { Result.failure(it) }
        remoto.getOrNull()?.let { lista ->
            val activas = lista.filter { it.activo }
            cache.guardar(claveTiendasDeZona(zonaId), activas)
            return Triple(activas.sortedBy { it.nombre.lowercase() }, false, null)
        }
        val copia = cache.leer(claveTiendasDeZona(zonaId), StoreDto::class.java)
            ?: cache.leer("tiendas", StoreDto::class.java)?.filter { it.zonaId == zonaId }
        val error = remoto.exceptionOrNull()?.message ?: "No se pudieron leer las tiendas."
        return if (copia != null) {
            Triple(copia.filter { it.activo }.sortedBy { it.nombre.lowercase() }, true, null)
        } else {
            Triple(null, false, "$error Conéctate al menos una vez para guardar las tiendas en el teléfono.")
        }
    }

    suspend fun ingreso(zonaId: String): Indicador<NivelIngreso> {
        if (!permisos.veIngreso) return Indicador.Oculto
        val r = runCatching { pedirClasificacion(zonaId) }.getOrElse { Result.failure(it) }
        return r.fold(
            onSuccess = { c -> if (c == null) Indicador.Aviso(SIN_CLASIFICACION) else Indicador.Listo(nivelDeIngreso(c)) },
            onFailure = { avisoDeFalla(it) },
        )
    }

    suspend fun cobertura(zonaId: String): Indicador<String> {
        if (!permisos.veCobertura) return Indicador.Oculto
        val r = runCatching { pedirCobertura(zonaId) }.getOrElse { Result.failure(it) }
        return r.fold(onSuccess = { indicadorCobertura(it) }, onFailure = { avisoDeFalla(it) })
    }

    suspend fun cargar(zonaId: String): DetalleZona {
        val (tiendas, desdeCopia, error) = tiendas(zonaId)
        return DetalleZona(tiendas, desdeCopia, error, ingreso(zonaId), cobertura(zonaId))
    }
}
