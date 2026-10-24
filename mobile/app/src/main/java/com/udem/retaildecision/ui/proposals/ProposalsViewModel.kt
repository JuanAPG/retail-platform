package com.udem.retaildecision.ui.proposals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.remote.dto.PresentacionDto
import com.udem.retaildecision.data.remote.dto.PriceProposalDto
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.repository.CatalogRepository
import com.udem.retaildecision.data.repository.ProposalsRepository
import com.udem.retaildecision.ui.observations.precioDesdeTexto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProposalsUiState(
    val cargando: Boolean = true,
    val error: String? = null,
    /** Productos de MI empresa que ya están activos (solo sobre esos se puede proponer precio). */
    val productos: List<ProductDto> = emptyList(),
    val propuestas: List<PriceProposalDto> = emptyList(),
    val producto: ProductDto? = null,
    val presentacion: PresentacionDto? = null,
    val precioTexto: String = "",
    val unidadCompra: String = "",
    val enviando: Boolean = false,
    val errorEnviar: String? = null,
    val mensaje: String? = null,
) {
    val precio: Double? get() = precioDesdeTexto(precioTexto)
    val puedeEnviar: Boolean get() = presentacion != null && precio != null && !enviando
}

class ProposalsViewModel(
    private val catalogRepository: CatalogRepository,
    private val proposalsRepository: ProposalsRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(ProposalsUiState())
    val state: StateFlow<ProposalsUiState> = _state.asStateFlow()

    init {
        cargar()
    }

    /** También sirve para el botón "Reintentar". */
    fun cargar() {
        _state.update { it.copy(cargando = true, error = null) }
        viewModelScope.launch {
            val productosRes = catalogRepository.productos()
            val propuestasRes = proposalsRepository.propuestas()
            val fallo = productosRes.exceptionOrNull() ?: propuestasRes.exceptionOrNull()
            if (fallo != null) {
                _state.update { it.copy(cargando = false, error = fallo.message) }
            } else {
                _state.update {
                    it.copy(
                        cargando = false,
                        productos = (productosRes.getOrNull() ?: emptyList()).filter { p -> p.estatus == "activo" },
                        propuestas = propuestasRes.getOrNull() ?: emptyList(),
                    )
                }
            }
        }
    }

    fun elegirProducto(producto: ProductDto) {
        val activas = producto.presentaciones.filter { it.activo }
        _state.update {
            it.copy(
                producto = producto,
                presentacion = activas.firstOrNull { p -> p.esPredeterminada } ?: activas.firstOrNull(),
                errorEnviar = null,
                mensaje = null,
            )
        }
    }

    fun elegirPresentacion(presentacion: PresentacionDto) {
        _state.update { it.copy(presentacion = presentacion) }
    }

    /** Solo deja dígitos y un separador decimal, con máximo 2 decimales. */
    fun cambiarPrecio(texto: String) {
        var hayPunto = false
        var decimales = 0
        val limpio = buildString {
            for (c in texto) {
                if (c.isDigit()) {
                    if (!hayPunto || decimales < 2) {
                        append(c)
                        if (hayPunto) decimales++
                    }
                } else if ((c == '.' || c == ',') && !hayPunto) {
                    hayPunto = true
                    append('.')
                }
            }
        }.take(13)
        _state.update { it.copy(precioTexto = limpio, mensaje = null) }
    }

    fun cambiarUnidadCompra(texto: String) {
        _state.update { it.copy(unidadCompra = texto.take(30)) }
    }

    fun enviar() {
        val actual = _state.value
        val presentacion = actual.presentacion ?: return
        val precio = actual.precio ?: return
        if (actual.enviando) return
        _state.update { it.copy(enviando = true, errorEnviar = null, mensaje = null) }
        viewModelScope.launch {
            proposalsRepository.crear(presentacion.id, precio, actual.unidadCompra)
                .onSuccess {
                    _state.update { s ->
                        s.copy(
                            enviando = false,
                            producto = null,
                            presentacion = null,
                            precioTexto = "",
                            unidadCompra = "",
                            propuestas = listOf(it) + s.propuestas,
                            mensaje = "Propuesta enviada. El Responsable de precios la revisará.",
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(enviando = false, errorEnviar = e.message) } }
        }
    }
}

class ProposalsViewModelFactory(
    private val catalogRepository: CatalogRepository,
    private val proposalsRepository: ProposalsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return ProposalsViewModel(catalogRepository, proposalsRepository) as T
    }
}