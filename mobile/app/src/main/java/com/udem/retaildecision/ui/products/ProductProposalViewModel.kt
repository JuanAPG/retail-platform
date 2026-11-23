package com.udem.retaildecision.ui.products

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.remote.dto.CategoriaDto
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.ProductProposalRequest
import com.udem.retaildecision.data.remote.dto.UnidadMedidaDto
import com.udem.retaildecision.data.repository.CatalogRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProductProposalUiState(
    val cargando: Boolean = true,
    val error: String? = null,
    val categorias: List<CategoriaDto> = emptyList(),
    val unidades: List<UnidadMedidaDto> = emptyList(),
    /** Los productos de MI empresa, en cualquier estatus. */
    val misProductos: List<ProductDto> = emptyList(),
    val sku: String = "",
    val nombre: String = "",
    val descripcion: String = "",
    val categoria: CategoriaDto? = null,
    val presentacion: String = "",
    val contenidoTexto: String = "",
    val unidad: UnidadMedidaDto? = null,
    val enviando: Boolean = false,
    val errorEnviar: String? = null,
    val mensaje: String? = null,
) {
    val contenido: Double? get() = contenidoTexto.toDoubleOrNull()?.takeIf { it > 0 }

    /** Reglas de catalog-service: sku ≤ 40, nombre ≤ 150, presentación ≤ 60, contenido > 0, categoría y unidad elegidas. */
    val puedeEnviar: Boolean
        get() = sku.isNotBlank() && nombre.isNotBlank() && presentacion.isNotBlank() &&
                categoria != null && unidad != null && contenido != null && !enviando
}

class ProductProposalViewModel(
    private val catalogRepository: CatalogRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(ProductProposalUiState())
    val state: StateFlow<ProductProposalUiState> = _state.asStateFlow()

    init {
        cargar()
    }

    fun cargar() {
        _state.update { it.copy(cargando = true, error = null) }
        viewModelScope.launch {
            val categorias = catalogRepository.categorias()
            val unidades = catalogRepository.unidades()
            val productos = catalogRepository.productos()
            val fallo = categorias.exceptionOrNull() ?: unidades.exceptionOrNull() ?: productos.exceptionOrNull()
            if (fallo != null) {
                _state.update { it.copy(cargando = false, error = fallo.message) }
            } else {
                _state.update {
                    it.copy(
                        cargando = false,
                        categorias = categorias.getOrNull() ?: emptyList(),
                        unidades = unidades.getOrNull() ?: emptyList(),
                        misProductos = productos.getOrNull() ?: emptyList(),
                    )
                }
            }
        }
    }

    fun cambiarSku(texto: String) = _state.update { it.copy(sku = texto.take(40).uppercase(), mensaje = null) }
    fun cambiarNombre(texto: String) = _state.update { it.copy(nombre = texto.take(150), mensaje = null) }
    fun cambiarDescripcion(texto: String) = _state.update { it.copy(descripcion = texto.take(300)) }
    fun elegirCategoria(c: CategoriaDto) = _state.update { it.copy(categoria = c) }
    fun cambiarPresentacion(texto: String) = _state.update { it.copy(presentacion = texto.take(60)) }
    fun elegirUnidad(u: UnidadMedidaDto) = _state.update { it.copy(unidad = u) }

    /** Solo dígitos y un punto decimal, máximo 3 decimales (el contenido llega como "1.000"). */
    fun cambiarContenido(texto: String) {
        var hayPunto = false
        var decimales = 0
        val limpio = buildString {
            for (c in texto) {
                if (c.isDigit()) {
                    if (!hayPunto || decimales < 3) {
                        append(c)
                        if (hayPunto) decimales++
                    }
                } else if ((c == '.' || c == ',') && !hayPunto) {
                    hayPunto = true
                    append('.')
                }
            }
        }.take(12)
        _state.update { it.copy(contenidoTexto = limpio) }
    }

    fun enviar() {
        val s = _state.value
        val categoria = s.categoria ?: return
        val unidad = s.unidad ?: return
        val contenido = s.contenido ?: return
        if (!s.puedeEnviar) return
        _state.update { it.copy(enviando = true, errorEnviar = null, mensaje = null) }
        viewModelScope.launch {
            catalogRepository.proponerProducto(
                ProductProposalRequest(
                    sku = s.sku.trim(),
                    nombre = s.nombre.trim(),
                    descripcion = s.descripcion.trim().ifEmpty { null },
                    categoriaId = categoria.id,
                    presentacion = s.presentacion.trim(),
                    contenido = contenido,
                    unidadMedida = unidad.clave,
                ),
            )
                .onSuccess { creado ->
                    _state.update {
                        it.copy(
                            enviando = false,
                            sku = "", nombre = "", descripcion = "", categoria = null,
                            presentacion = "", contenidoTexto = "", unidad = null,
                            misProductos = listOf(creado) + it.misProductos,
                            mensaje = "Propuesta enviada. El Gerente de categoría la revisará.",
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(enviando = false, errorEnviar = e.message) } }
        }
    }
}

class ProductProposalViewModelFactory(
    private val catalogRepository: CatalogRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return ProductProposalViewModel(catalogRepository) as T
    }
}