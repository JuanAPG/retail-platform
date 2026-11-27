package com.udem.retaildecision.ui.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.local.AlmacenListas
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Todo lo que la pantalla necesita pintar en un momento dado. */
data class CatalogUiState(
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

class CatalogViewModel(
    private val repository: CatalogRepository,
    private val cache: AlmacenListas? = null,
    /** false para el Proveedor: no lee tiendas (403), así que no se piden. */
    private val cargarTiendas: Boolean = false,
    /** Solo los 6 perfiles internos (income-segmentation-service). null = el rol no lo ve y no se pide. */
    private val clasificaciones: (suspend () -> Result<List<ZoneClassificationDto>>)? = null,
) : ViewModel() {

    private val _state = MutableStateFlow(CatalogUiState())
    val state: StateFlow<CatalogUiState> = _state.asStateFlow()

    init {
        cargar()
    }

    /** Pide productos, zonas, tiendas y (si aplica) clasificaciones. También sirve para el botón "Reintentar". */
    fun cargar() {
        _state.update { it.copy(cargando = true, error = null) }
        viewModelScope.launch {
            val productosAsync = async { repository.productos() }
            val zonasAsync = async { repository.zonas() }
            val tiendasAsync = async { if (cargarTiendas) repository.tiendas() else null }
            val clasificacionesAsync = async { clasificaciones?.invoke() }

            val productos = productosAsync.await()
            val zonasRes = zonasAsync.await()
            val tiendasRes = tiendasAsync.await()
            val clasifRes = clasificacionesAsync.await()

            // Zonas y tiendas se guardan en el teléfono para que la pestaña y el detalle sirvan sin internet.
            zonasRes.getOrNull()?.let { cache?.guardar(CLAVE_ZONAS, it) }
            tiendasRes?.getOrNull()?.let { cache?.guardar(CLAVE_TIENDAS, it) }
            val zonas = zonasRes.getOrNull() ?: cache?.leer(CLAVE_ZONAS, ZoneDto::class.java)
            val tiendas: List<StoreDto>? = tiendasRes?.let { r -> r.getOrNull() ?: cache?.leer(CLAVE_TIENDAS, StoreDto::class.java) }

            _state.update {
                it.copy(
                    cargando = false,
                    productos = productos.getOrDefault(emptyList()),
                    zonas = zonas.orEmpty(),
                    zonasDesdeCopia = zonasRes.isFailure && zonas != null,
                    tiendasPorZona = tiendas?.let(::tiendasPorZona),
                    niveles = clasifRes?.getOrNull()?.let(::nivelesPorZona).orEmpty(),
                    avisoIngreso = clasifRes?.exceptionOrNull()?.let { e -> avisoDeFalla(e).texto },
                    // Si ambas fallan (y no hay copia de zonas) se muestra el error; si no, la otra pestaña sigue sirviendo.
                    error = if (productos.isFailure && zonas == null) {
                        productos.exceptionOrNull()?.message
                    } else null,
                )
            }
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
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return CatalogViewModel(repository, cache, cargarTiendas, clasificaciones) as T
    }
}
