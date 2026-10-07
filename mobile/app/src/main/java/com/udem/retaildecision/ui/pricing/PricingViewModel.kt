package com.udem.retaildecision.ui.pricing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.repository.CatalogRepository
import com.udem.retaildecision.data.repository.PrecioProducto
import com.udem.retaildecision.data.repository.PricingRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PricingUiState(
    val cargandoProductos: Boolean = true,
    val productos: List<ProductDto> = emptyList(),
    val seleccionado: ProductDto? = null,
    val cargandoPrecios: Boolean = false,
    val precios: PrecioProducto? = null,
    val error: String? = null,
)

class PricingViewModel(
    private val catalogRepository: CatalogRepository,
    private val pricingRepository: PricingRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(PricingUiState())
    val state: StateFlow<PricingUiState> = _state.asStateFlow()

    init {
        cargarProductos()
    }

    private fun cargarProductos() {
        _state.update { it.copy(cargandoProductos = true, error = null) }
        viewModelScope.launch {
            catalogRepository.productos()
                .onSuccess { lista ->
                    _state.update { it.copy(cargandoProductos = false, productos = lista) }
                    // Se abre con el primer producto para no mostrar la pantalla vacía.
                    lista.firstOrNull()?.let { seleccionar(it) }
                }
                .onFailure { e ->
                    _state.update { it.copy(cargandoProductos = false, error = e.message) }
                }
        }
    }

    fun seleccionar(producto: ProductDto) {
        _state.update { it.copy(seleccionado = producto, cargandoPrecios = true, precios = null, error = null) }
        viewModelScope.launch {
            pricingRepository.cargar(producto.id)
                .onSuccess { datos ->
                    _state.update { it.copy(cargandoPrecios = false, precios = datos) }
                }
                .onFailure { e ->
                    _state.update { it.copy(cargandoPrecios = false, error = e.message) }
                }
        }
    }

    /** Botón "Reintentar": repite lo último que falló. */
    fun reintentar() {
        val producto = _state.value.seleccionado
        if (producto == null) cargarProductos() else seleccionar(producto)
    }
}

class PricingViewModelFactory(
    private val catalogRepository: CatalogRepository,
    private val pricingRepository: PricingRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return PricingViewModel(catalogRepository, pricingRepository) as T
    }
}