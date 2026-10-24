package com.udem.retaildecision.ui.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.remote.dto.PriceObservationDto
import com.udem.retaildecision.data.repository.PriceReviewRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PriceReviewUiState(
    val cargando: Boolean = true,
    val error: String? = null,
    val pendientes: List<PriceObservationDto> = emptyList(),
    /** Id de la captura que se está resolviendo (bloquea sus botones). */
    val procesandoId: String? = null,
    /** Captura para la que se está pidiendo el motivo del rechazo. */
    val rechazando: PriceObservationDto? = null,
    val errorAccion: String? = null,
    val mensaje: String? = null,
)

/**
 * `puedeResolver` es true solo para el Responsable de precios (D1). Administrador y Auditor
 * ven la cola en modo lectura; el servidor igual responde 403 a cualquier otro.
 */
class PriceReviewViewModel(
    private val repository: PriceReviewRepository,
    val puedeResolver: Boolean,
) : ViewModel() {

    private val _state = MutableStateFlow(PriceReviewUiState())
    val state: StateFlow<PriceReviewUiState> = _state.asStateFlow()

    init {
        cargar()
    }

    fun cargar() {
        _state.update { it.copy(cargando = true, error = null, errorAccion = null) }
        viewModelScope.launch {
            repository.pendientes()
                .onSuccess { lista -> _state.update { it.copy(cargando = false, pendientes = lista) } }
                .onFailure { e -> _state.update { it.copy(cargando = false, error = e.message) } }
        }
    }

    fun aprobar(item: PriceObservationDto) {
        if (!puedeResolver || _state.value.procesandoId != null) return
        _state.update { it.copy(procesandoId = item.id, errorAccion = null, mensaje = null) }
        viewModelScope.launch {
            repository.aprobar(item.id)
                .onSuccess {
                    _state.update { s ->
                        s.copy(
                            procesandoId = null,
                            pendientes = s.pendientes.filter { it.id != item.id },
                            mensaje = "Precio aprobado. Ya forma parte del historial.",
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(procesandoId = null, errorAccion = e.message) } }
        }
    }

    fun pedirRechazo(item: PriceObservationDto) {
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
            repository.rechazar(item.id, motivo)
                .onSuccess {
                    _state.update { s ->
                        s.copy(
                            procesandoId = null,
                            pendientes = s.pendientes.filter { it.id != item.id },
                            mensaje = "Captura rechazada. Se avisó a quien la levantó.",
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(procesandoId = null, errorAccion = e.message) } }
        }
    }
}

class PriceReviewViewModelFactory(
    private val repository: PriceReviewRepository,
    private val puedeResolver: Boolean,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return PriceReviewViewModel(repository, puedeResolver) as T
    }
}