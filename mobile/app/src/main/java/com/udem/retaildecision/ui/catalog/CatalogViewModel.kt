package com.udem.retaildecision.ui.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.local.AlmacenListas
import com.udem.retaildecision.data.model.Rol
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.remote.dto.ZoneClassificationDto
import com.udem.retaildecision.data.remote.dto.ZoneDto
import com.udem.retaildecision.data.repository.CatalogRepository
import com.udem.retaildecision.ui.zones.NivelIngreso
import com.udem.retaildecision.ui.zones.avisoDeFalla
import com.udem.retaildecision.ui.zones.nivelesPorZona
import com.udem.retaildecision.ui.zones.tiendasPorZona
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * GET /v1/zones (catalog-service): los 6 perfiles internos y el Investigador de mercado (D-28). Al
 * Proveedor le responde 403, así que para él el Catálogo es solo Productos: sin pestaña Zonas y sin
 * pedir zonas.
 */
fun catalogoMuestraZonas(rol: String?): Boolean = rol != null && (rol in Rol.INTERNOS || rol == Rol.INVESTIGADOR)

/** Todo lo que la pantalla necesita pintar en un momento dado. */
data class CatalogUiState(
    /** false para el Proveedor: la pantalla no muestra la barra de pestañas ni la pestaña Zonas. */
    val muestraZonas: Boolean = true,
    val cargando: Boolean = true,
    val error: String? = null,
    val productos: List<ProductDto> = emptyList(),
    val zonas: List<ZoneDto> = emptyList(),
    /** true si las zonas salen de la copia guardada en el teléfono (no hubo conexión). */
    val zonasDesdeCopia: Boolean = false,
    /** Tiendas activas por zona. null = no se pudo saber (sin red y sin copia): la tarjeta no muestra el número. */
    val tiendasPorZona: Map<String, Int>? = null,
    /** Nivel de ingreso vigente por zona. Vacío para el Investigador de mercado (no lo ve, D-28). */
    val niveles: Map<String, NivelIngreso> = emptyMap(),
    /** Texto discreto cuando el rol sí ve el ingreso pero no se pudo leer ("No disponible sin conexión"). */
    val avisoIngreso: String? = null,
)

/** Claves de la copia en el teléfono. "tiendas" es la misma que usa Capturas en tienda. */
private const val CLAVE_ZONAS = "zonas"
private const val CLAVE_TIENDAS = "tiendas"

/**
 * Carga del catálogo, sin depender de Android (se prueba en la JVM). Con `muestraZonas = false` no se
 * llama a `zonas` (ni a tiendas ni a clasificaciones, que solo sirven para la pestaña Zonas).
 */
internal suspend fun cargarCatalogo(
    muestraZonas: Boolean,
    productos: suspend () -> Result<List<ProductDto>>,
    zonas: suspend () -> Result<List<ZoneDto>>,
    tiendas: (suspend () -> Result<List<StoreDto>>)?,
    clasificaciones: (suspend () -> Result<List<ZoneClassificationDto>>)?,
    cache: AlmacenListas?,
): CatalogUiState = coroutineScope {
    val productosAsync = async { productos() }
    val zonasAsync = async { if (muestraZonas) zonas() else null }
    val tiendasAsync = async { if (muestraZonas) tiendas?.invoke() else null }
    val clasificacionesAsync = async { if (muestraZonas) clasificaciones?.invoke() else null }

    val productosRes = productosAsync.await()
    val zonasRes = zonasAsync.await()
    val tiendasRes = tiendasAsync.await()
    val clasifRes = clasificacionesAsync.await()

    // Zonas y tiendas se guardan en el teléfono para que la pestaña y el detalle sirvan sin internet.
    zonasRes?.getOrNull()?.let { cache?.guardar(CLAVE_ZONAS, it) }
    tiendasRes?.getOrNull()?.let { cache?.guardar(CLAVE_TIENDAS, it) }
    val zonasLista = zonasRes?.let { r -> r.getOrNull() ?: cache?.leer(CLAVE_ZONAS, ZoneDto::class.java) }
    val tiendasLista: List<StoreDto>? = tiendasRes?.let { r -> r.getOrNull() ?: cache?.leer(CLAVE_TIENDAS, StoreDto::class.java) }

    CatalogUiState(
        muestraZonas = muestraZonas,
        cargando = false,
        productos = productosRes.getOrDefault(emptyList()),
        zonas = zonasLista.orEmpty(),
        zonasDesdeCopia = zonasRes?.isFailure == true && zonasLista != null,
        tiendasPorZona = tiendasLista?.let(::tiendasPorZona),
        niveles = clasifRes?.getOrNull()?.let(::nivelesPorZona).orEmpty(),
        avisoIngreso = clasifRes?.exceptionOrNull()?.let { e -> avisoDeFalla(e).texto },
        // Si ambas fallan (y no hay copia de zonas) se muestra el error; si no, la otra pestaña sigue sirviendo.
        // Sin pestaña Zonas (Proveedor), basta con que fallen los productos.
        error = if (productosRes.isFailure && zonasLista == null) productosRes.exceptionOrNull()?.message else null,
    )
}

class CatalogViewModel(
    private val repository: CatalogRepository,
    private val cache: AlmacenListas? = null,
    /** false para el Proveedor: no lee tiendas (403), así que no se piden. */
    private val cargarTiendas: Boolean = false,
    /** Solo los 6 perfiles internos (income-segmentation-service). null = el rol no lo ve y no se pide. */
    private val clasificaciones: (suspend () -> Result<List<ZoneClassificationDto>>)? = null,
    /** false para el Proveedor (`catalogoMuestraZonas`): no se piden zonas y no hay pestaña Zonas. */
    private val muestraZonas: Boolean = true,
) : ViewModel() {

    private val _state = MutableStateFlow(CatalogUiState(muestraZonas = muestraZonas))
    val state: StateFlow<CatalogUiState> = _state.asStateFlow()

    init {
        cargar()
    }

    /** Pide productos, zonas, tiendas y (si aplica) clasificaciones. También sirve para el botón "Reintentar". */
    fun cargar() {
        _state.update { it.copy(cargando = true, error = null) }
        viewModelScope.launch {
            val nuevo = cargarCatalogo(
                muestraZonas = muestraZonas,
                productos = { repository.productos() },
                zonas = { repository.zonas() },
                tiendas = if (cargarTiendas) ({ repository.tiendas() }) else null,
                clasificaciones = clasificaciones,
                cache = cache,
            )
            _state.update { nuevo }
        }
    }

    fun zona(id: String): ZoneDto? = _state.value.zonas.firstOrNull { it.id == id }

    companion object {
        /** Zona desde la copia del teléfono, para cuando el detalle se abre sin la lista en memoria. */
        fun zonaGuardada(cache: AlmacenListas, id: String): ZoneDto? =
            cache.leer(CLAVE_ZONAS, ZoneDto::class.java)?.firstOrNull { it.id == id }
    }
}

class CatalogViewModelFactory(
    private val repository: CatalogRepository,
    private val cache: AlmacenListas? = null,
    private val cargarTiendas: Boolean = false,
    private val clasificaciones: (suspend () -> Result<List<ZoneClassificationDto>>)? = null,
    private val muestraZonas: Boolean = true,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return CatalogViewModel(repository, cache, cargarTiendas, clasificaciones, muestraZonas) as T
    }
}
