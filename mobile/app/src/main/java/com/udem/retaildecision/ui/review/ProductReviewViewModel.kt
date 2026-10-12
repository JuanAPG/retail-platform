package com.udem.retaildecision.ui.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.repository.CatalogRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProductReviewUiState(
    val cargando: Boolean = true,
    val error: String? = null,
    val pendientes: List<ProductDto> = emptyList(),
    val procesandoId: String? = null,
    val rechazando: ProductDto? = null,
    val errorAccion: String? = null,
    val mensaje: String? = null,
)

/**
 * Bandeja de productos propuestos por Proveedores (D-08). `puedeResolver` es true solo para el
 * Gerente de categoría; Administrador y Auditor la leen sin botones.
 */
class ProductReviewViewModel(
    private val repository: CatalogRepository,
    val puedeResolver: Boolean,
) : ViewModel() {

    private val _state = MutableStateFlow(ProductReviewUiState())
    val state: StateFlow<ProductReviewUiState> = _state.asStateFlow()

    init {
        cargar()
    }

    fun cargar() {
        _state.update { it.copy(cargando = true, error = null, errorAccion = null) }
        viewModelScope.launch {
            repository.productosPendientes()
                .onSuccess { lista -> _state.update { it.copy(cargando = false, pendientes = lista) } }
                .onFailure { e -> _state.update { it.copy(cargando = false, error = e.message) } }
        }
    }

    fun aprobar(item: ProductDto) {
        if (!puedeResolver || _state.value.procesandoId != null) return
        _state.update { it.copy(procesandoId = item.id, errorAccion = null, mensaje = null) }
        viewModelScope.launch {
            repository.aprobarProducto(item.id)
                .onSuccess {
                    _state.update { s ->
                        s.copy(
                            procesandoId = null,
                            pendientes = s.pendientes.filter { it.id != item.id },
                            mensaje = "Producto aprobado. Ya es visible para todos.",
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(procesandoId = null, errorAccion = e.message) } }
        }
    }

    fun pedirRechazo(item: ProductDto) {
        if (!puedeResolver) return
        _state.update { it.copy(rechazando = item, errorAccion = null, mensaje = null) }
    }

    fun cancelarRechazo() {
        _state.update { it.copy(rechazando = null) }
    }

    fun confirmarRechazo(motivo: String) {
        val item = _state.value.rechazando ?: return
        if (_state.value.procesandoId != null) return
        _state.update { it.copy(rechazando = null, procesandoId = item.id) }
        viewModelScope.launch {
            repository.rechazarProducto(item.id, motivo)
                .onSuccess {
                    _state.update { s ->
                        s.copy(
                            procesandoId = null,
                            pendientes = s.pendientes.filter { it.id != item.id },
                            mensaje = "Producto rechazado. El Proveedor verá el motivo.",
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(procesandoId = null, errorAccion = e.message) } }
        }
    }
}

class ProductReviewViewModelFactory(
    private val repository: CatalogRepository,
    private val puedeResolver: Boolean,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return ProductReviewViewModel(repository, puedeResolver) as T
    }
}