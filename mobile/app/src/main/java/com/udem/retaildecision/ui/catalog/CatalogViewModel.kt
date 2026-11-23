package com.udem.retaildecision.ui.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.ZoneDto
import com.udem.retaildecision.data.repository.CatalogRepository
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
)

class CatalogViewModel(private val repository: CatalogRepository) : ViewModel() {

    private val _state = MutableStateFlow(CatalogUiState())
    val state: StateFlow<CatalogUiState> = _state.asStateFlow()

    init {
        cargar()
    }

    /** Pide productos y zonas. También sirve para el botón "Reintentar". */
    fun cargar() {
        _state.update { it.copy(cargando = true, error = null) }
        viewModelScope.launch {
            val productos = repository.productos()
            val zonas = repository.zonas()
            _state.update {
                it.copy(
                    cargando = false,
                    productos = productos.getOrDefault(emptyList()),
                    zonas = zonas.getOrDefault(emptyList()),
                    // Si ambas fallan se muestra el error; si solo falla una, la otra pestaña sigue sirviendo.
                    error = if (productos.isFailure && zonas.isFailure) {
                        productos.exceptionOrNull()?.message
                    } else null,
                )
            }
        }
    }
}

class CatalogViewModelFactory(private val repository: CatalogRepository) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return CatalogViewModel(repository) as T
    }
}