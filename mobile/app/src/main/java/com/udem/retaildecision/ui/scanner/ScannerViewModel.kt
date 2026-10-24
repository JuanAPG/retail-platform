package com.udem.retaildecision.ui.scanner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.remote.dto.PresentacionDto
import com.udem.retaildecision.data.remote.dto.PriceHistoryDto
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.repository.CatalogRepository
import com.udem.retaildecision.data.repository.PricingRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Todo lo que la pantalla del escáner necesita pintar. */
data class ScannerUiState(
    /** Mientras se descarga el catálogo no se puede buscar ningún código. */
    val cargandoCatalogo: Boolean = true,
    val errorCatalogo: String? = null,
    /** true = la cámara está leyendo; false = ya se leyó un código y se muestra el resultado. */
    val escaneando: Boolean = true,
    val codigo: String? = null,
    val producto: ProductDto? = null,
    val presentacion: PresentacionDto? = null,
    val noEncontrado: Boolean = false,
    val cargandoPrecios: Boolean = false,
    /** Precios vigentes de ESTA presentación, del más barato al más caro. */
    val precios: List<PriceHistoryDto> = emptyList(),
    val errorPrecios: String? = null,
)

class ScannerViewModel(
    private val catalogRepository: CatalogRepository,
    private val pricingRepository: PricingRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(ScannerUiState())
    val state: StateFlow<ScannerUiState> = _state.asStateFlow()

    /** Código de barras (sin ceros a la izquierda) -> producto y presentación a la que pertenece. */
    private var indice: Map<String, Pair<ProductDto, PresentacionDto>> = emptyMap()

    init {
        cargarCatalogo()
    }

    /** También sirve para el botón "Reintentar". */
    fun cargarCatalogo() {
        _state.update { it.copy(cargandoCatalogo = true, errorCatalogo = null) }
        viewModelScope.launch {
            catalogRepository.productos()
                .onSuccess { lista ->
                    val mapa = mutableMapOf<String, Pair<ProductDto, PresentacionDto>>()
                    for (producto in lista) {
                        for (presentacion in producto.presentaciones) {
                            val clave = normalizarCodigo(presentacion.codigoBarras ?: continue)
                            if (clave.isNotEmpty()) mapa[clave] = producto to presentacion
                        }
                    }
                    indice = mapa
                    _state.update { it.copy(cargandoCatalogo = false) }
                }
                .onFailure { e ->
                    _state.update { it.copy(cargandoCatalogo = false, errorCatalogo = e.message) }
                }
        }
    }

    /** La cámara o el campo manual leyeron un código. */
    fun buscarCodigo(crudo: String) {
        val codigo = crudo.trim()
        if (codigo.isEmpty() || _state.value.cargandoCatalogo) return

        val hallado = indice[normalizarCodigo(codigo)]
        if (hallado == null) {
            _state.update {
                ScannerUiState(
                    cargandoCatalogo = false,
                    escaneando = false,
                    codigo = codigo,
                    noEncontrado = true,
                )
            }
            return
        }

        val (producto, presentacion) = hallado
        _state.update {
            ScannerUiState(
                cargandoCatalogo = false,
                escaneando = false,
                codigo = codigo,
                producto = producto,
                presentacion = presentacion,
                cargandoPrecios = true,
            )
        }
        viewModelScope.launch {
            pricingRepository.cargar(producto.id)
                .onSuccess { datos ->
                    val vigentes = datos.historial
                        .filter { it.presentationId == presentacion.id && it.vigente }
                        .sortedBy { it.price.toDoubleOrNull() ?: Double.MAX_VALUE }
                    _state.update { it.copy(cargandoPrecios = false, precios = vigentes) }
                }
                .onFailure { e ->
                    _state.update { it.copy(cargandoPrecios = false, errorPrecios = e.message) }
                }
        }
    }

    /** Botón "Escanear otro": limpia el resultado y vuelve a abrir la cámara. */
    fun escanearOtro() {
        _state.update { ScannerUiState(cargandoCatalogo = false, escaneando = true) }
    }

    /**
     * Quita espacios y ceros a la izquierda: una lectora puede entregar un UPC-A de 12 dígitos
     * y la base guardarlo como EAN-13 de 13 (con un 0 delante), y deben considerarse el mismo.
     */
    private fun normalizarCodigo(codigo: String): String = codigo.trim().trimStart('0')
}

class ScannerViewModelFactory(
    private val catalogRepository: CatalogRepository,
    private val pricingRepository: PricingRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return ScannerViewModel(catalogRepository, pricingRepository) as T
    }
}