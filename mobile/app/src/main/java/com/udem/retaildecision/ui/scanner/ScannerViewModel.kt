package com.udem.retaildecision.ui.scanner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.local.AlmacenListas
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
    /** false para el Investigador de mercado: no puede leer precios (Matriz §3 M08, D-28). */
    val muestraPrecios: Boolean = true,
    /** Tipos de captura que el rol puede enviar (`TipoCaptura.permitidosPara`). Vacío = sin botones de captura. */
    val tiposCaptura: List<String> = emptyList(),
    /** true si el catálogo sale de la copia guardada en el teléfono (no hubo conexión). */
    val usandoCopiaLocal: Boolean = false,
) {
    /** "Capturar precio" y/o "Capturar existencia" para el código encontrado. */
    val botonesCaptura: List<String> get() = botonesCaptura(tiposCaptura, producto, presentacion)
}

class ScannerViewModel(
    private val catalogRepository: CatalogRepository,
    private val pricingRepository: PricingRepository,
    private val puedeVerPrecios: Boolean = true,
    private val tiposCaptura: List<String> = emptyList(),
    /** Copia de productos en el teléfono (la misma que usa Capturas en tienda), para buscar sin internet. */
    private val cache: AlmacenListas? = null,
) : ViewModel() {

    private val _state = MutableStateFlow(ScannerUiState(muestraPrecios = puedeVerPrecios, tiposCaptura = tiposCaptura))
    val state: StateFlow<ScannerUiState> = _state.asStateFlow()

    /** Código de barras (sin ceros a la izquierda) -> producto y presentación a la que pertenece. */
    private var indice = IndiceCodigos(emptyList())

    init {
        cargarCatalogo()
    }

    /** También sirve para el botón "Reintentar". */
    fun cargarCatalogo() {
        _state.update { it.copy(cargandoCatalogo = true, errorCatalogo = null) }
        viewModelScope.launch {
            val res = catalogRepository.productos()
            res.getOrNull()?.let { cache?.guardar(CLAVE_PRODUCTOS, it) }
            // Sin internet se busca en la última copia guardada.
            val lista = res.getOrNull() ?: cache?.leer(CLAVE_PRODUCTOS, ProductDto::class.java)
            if (lista != null) {
                indice = IndiceCodigos(lista)
                _state.update { it.copy(cargandoCatalogo = false, usandoCopiaLocal = res.isFailure) }
            } else {
                _state.update { it.copy(cargandoCatalogo = false, errorCatalogo = res.exceptionOrNull()?.message) }
            }
        }
    }

    /** La cámara o el campo manual leyeron un código. */
    fun buscarCodigo(crudo: String) {
        val codigo = crudo.trim()
        if (codigo.isEmpty() || _state.value.cargandoCatalogo) return

        val hallado = indice.buscar(codigo)
        if (hallado == null) {
            _state.update {
                ScannerUiState(
                    cargandoCatalogo = false,
                    escaneando = false,
                    codigo = codigo,
                    noEncontrado = true,
                    muestraPrecios = puedeVerPrecios,
                    tiposCaptura = tiposCaptura,
                    usandoCopiaLocal = it.usandoCopiaLocal,
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
                cargandoPrecios = puedeVerPrecios,
                muestraPrecios = puedeVerPrecios,
                tiposCaptura = tiposCaptura,
                usandoCopiaLocal = it.usandoCopiaLocal,
            )
        }
        if (!puedeVerPrecios) return
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
        _state.update {
            ScannerUiState(
                cargandoCatalogo = false,
                escaneando = true,
                muestraPrecios = puedeVerPrecios,
                tiposCaptura = tiposCaptura,
                usandoCopiaLocal = it.usandoCopiaLocal,
            )
        }
    }

    private companion object {
        /** La misma clave que usa Capturas en tienda. */
        const val CLAVE_PRODUCTOS = "productos"
    }
}

class ScannerViewModelFactory(
    private val catalogRepository: CatalogRepository,
    private val pricingRepository: PricingRepository,
    private val puedeVerPrecios: Boolean = true,
    private val tiposCaptura: List<String> = emptyList(),
    private val cache: AlmacenListas? = null,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return ScannerViewModel(catalogRepository, pricingRepository, puedeVerPrecios, tiposCaptura, cache) as T
    }
}