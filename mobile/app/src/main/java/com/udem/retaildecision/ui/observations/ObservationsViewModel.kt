package com.udem.retaildecision.ui.observations

import android.location.Location
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.local.CatalogCache
import com.udem.retaildecision.data.location.LocationProvider
import com.udem.retaildecision.data.location.Ubicacion
import com.udem.retaildecision.data.remote.dto.PresentacionDto
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.repository.CatalogRepository
import com.udem.retaildecision.data.repository.ObservacionGuardada
import com.udem.retaildecision.data.repository.ObservationRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val PRECIO_MAXIMO = 9_999_999_999.99

/** Convierte lo escrito ("27.50" o "27,5") en un precio válido: mayor que 0, hasta 2 decimales. */
fun precioDesdeTexto(texto: String): Double? {
    val numero = texto.trim().replace(',', '.').toDoubleOrNull() ?: return null
    return if (numero > 0.0 && numero <= PRECIO_MAXIMO) numero else null
}

/** Distancia en metros entre la ubicación y la dirección de la tienda, o null si la tienda no tiene coordenadas. */
fun distanciaATienda(tienda: StoreDto?, ubicacion: Ubicacion?): Int? {
    val direccion = tienda?.direccion ?: return null
    val lat = direccion.latitud?.toDoubleOrNull() ?: return null
    val lon = direccion.longitud?.toDoubleOrNull() ?: return null
    if (ubicacion == null) return null
    val resultado = FloatArray(1)
    Location.distanceBetween(ubicacion.latitud, ubicacion.longitud, lat, lon, resultado)
    return resultado[0].toInt()
}

data class ObservationsUiState(
    val cargandoCatalogo: Boolean = true,
    val errorCatalogo: String? = null,
    /** true si las listas salen de la copia guardada en el teléfono (no hubo conexión). */
    val usandoCopiaLocal: Boolean = false,
    val tiendas: List<StoreDto> = emptyList(),
    val productos: List<ProductDto> = emptyList(),
    val tienda: StoreDto? = null,
    val busqueda: String = "",
    val producto: ProductDto? = null,
    val presentacion: PresentacionDto? = null,
    val precioTexto: String = "",
    val obteniendoUbicacion: Boolean = false,
    val ubicacion: Ubicacion? = null,
    val errorUbicacion: String? = null,
    val guardando: Boolean = false,
    val errorGuardar: String? = null,
    val mensaje: String? = null,
    val capturas: List<ObservacionGuardada> = emptyList(),
    val actualizandoEstados: Boolean = false,
) {
    val precio: Double? get() = precioDesdeTexto(precioTexto)

    /** Productos que coinciden con lo escrito (nombre o SKU), máximo 6, mientras no haya uno elegido. */
    val sugerencias: List<ProductDto>
        get() {
            val q = busqueda.trim()
            if (producto != null || q.length < 2) return emptyList()
            return productos.filter { it.nombre.contains(q, ignoreCase = true) || it.sku.contains(q, ignoreCase = true) }.take(6)
        }

    val puedeGuardar: Boolean
        get() = tienda != null && presentacion != null && precio != null && ubicacion != null && !guardando
}

class ObservationsViewModel(
    private val catalogRepository: CatalogRepository,
    private val observationRepository: ObservationRepository,
    private val locationProvider: LocationProvider,
    private val cache: CatalogCache,
    /** Pide al sistema que envíe lo pendiente en cuanto haya internet (SyncScheduler). */
    private val programarEnvio: () -> Unit,
) : ViewModel() {

    private val _state = MutableStateFlow(ObservationsUiState())
    val state: StateFlow<ObservationsUiState> = _state.asStateFlow()

    init {
        cargarCatalogo()
        refrescarEstados(avisar = false)
        // La lista de capturas se actualiza sola cada vez que se guarda una o el envío cambia su estado.
        viewModelScope.launch {
            observationRepository.capturas().collect { lista -> _state.update { it.copy(capturas = lista) } }
        }
    }

    /** También sirve para el botón "Reintentar". Sin internet usa la última copia guardada. */
    fun cargarCatalogo() {
        _state.update { it.copy(cargandoCatalogo = true, errorCatalogo = null) }
        viewModelScope.launch {
            val tiendasRes = catalogRepository.tiendas()
            val productosRes = catalogRepository.productos()

            tiendasRes.getOrNull()?.let { cache.guardar("tiendas", it) }
            productosRes.getOrNull()?.let { cache.guardar("productos", it) }

            val tiendas = tiendasRes.getOrNull() ?: cache.leer("tiendas", StoreDto::class.java)
            val productos = productosRes.getOrNull() ?: cache.leer("productos", ProductDto::class.java)

            if (tiendas == null || productos == null) {
                val motivo = tiendasRes.exceptionOrNull()?.message ?: productosRes.exceptionOrNull()?.message
                _state.update {
                    it.copy(
                        cargandoCatalogo = false,
                        errorCatalogo = (motivo ?: "No se pudo cargar el catálogo.") +
                                " Conéctate al menos una vez para guardar las tiendas y los productos en el teléfono.",
                    )
                }
            } else {
                val desdeCopia = tiendasRes.isFailure || productosRes.isFailure
                _state.update {
                    it.copy(
                        cargandoCatalogo = false,
                        usandoCopiaLocal = desdeCopia,
                        tiendas = tiendas.filter { t -> t.activo },
                        productos = productos.filter { p -> p.estatus == "activo" },
                    )
                }
            }
        }
    }

    fun elegirTienda(tienda: StoreDto) {
        _state.update { it.copy(tienda = tienda, mensaje = null, errorGuardar = null) }
    }

    fun cambiarBusqueda(texto: String) {
        _state.update {
            // Si se edita el texto después de elegir un producto, se descarta la elección.
            val sigue = it.producto != null && texto == it.producto.nombre
            it.copy(
                busqueda = texto.take(80),
                producto = if (sigue) it.producto else null,
                presentacion = if (sigue) it.presentacion else null,
                mensaje = null,
            )
        }
    }

    fun elegirProducto(producto: ProductDto) {
        val activas = producto.presentaciones.filter { it.activo }
        _state.update {
            it.copy(
                producto = producto,
                busqueda = producto.nombre,
                presentacion = activas.firstOrNull { p -> p.esPredeterminada } ?: activas.firstOrNull(),
                mensaje = null,
                errorGuardar = null,
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

    fun obtenerUbicacion() {
        _state.update { it.copy(obteniendoUbicacion = true, errorUbicacion = null, mensaje = null) }
        viewModelScope.launch {
            locationProvider.actual()
                .onSuccess { u -> _state.update { it.copy(obteniendoUbicacion = false, ubicacion = u) } }
                .onFailure { e -> _state.update { it.copy(obteniendoUbicacion = false, errorUbicacion = e.message) } }
        }
    }

    fun permisoDenegado() {
        _state.update {
            it.copy(errorUbicacion = "Sin el permiso de ubicación no se puede guardar el precio. Puedes darlo desde los ajustes del teléfono.")
        }
    }

    fun guardar() {
        val actual = _state.value
        val tienda = actual.tienda ?: return
        val producto = actual.producto ?: return
        val presentacion = actual.presentacion ?: return
        val precio = actual.precio ?: return
        val ubicacion = actual.ubicacion ?: return
        if (actual.guardando) return
        _state.update { it.copy(guardando = true, errorGuardar = null, mensaje = null) }
        viewModelScope.launch {
            observationRepository.guardar(tienda, producto, presentacion, precio, ubicacion, distanciaATienda(tienda, ubicacion))
                .onSuccess {
                    programarEnvio()
                    // Se limpia el producto, el precio y la ubicación; la tienda se queda para capturar el siguiente producto.
                    _state.update {
                        it.copy(
                            guardando = false,
                            busqueda = "",
                            producto = null,
                            presentacion = null,
                            precioTexto = "",
                            ubicacion = null,
                            mensaje = "Precio guardado en el teléfono. Se enviará solo cuando haya internet.",
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(guardando = false, errorGuardar = e.message) } }
        }
    }

    /**
     * Pregunta si el Responsable de precios ya aprobó o rechazó las capturas enviadas.
     * Se llama al abrir la pantalla (sin avisar si no hay internet) y con el botón "Actualizar estados".
     */
    fun refrescarEstados(avisar: Boolean = true) {
        if (_state.value.actualizandoEstados) return
        _state.update { it.copy(actualizandoEstados = true) }
        viewModelScope.launch {
            observationRepository.actualizarDecisiones()
                .onSuccess { cambios ->
                    _state.update {
                        it.copy(
                            actualizandoEstados = false,
                            mensaje = if (avisar) {
                                if (cambios > 0) "Se actualizó el estado de $cambios captura(s)." else "Sin novedades: nadie ha decidido más capturas."
                            } else it.mensaje,
                        )
                    }
                }
                .onFailure { e ->
                    _state.update { it.copy(actualizandoEstados = false, errorGuardar = if (avisar) e.message else it.errorGuardar) }
                }
        }
    }

    /** Botón "Enviar ahora": vuelve a pedir el envío de lo pendiente. */
    fun enviarAhora() {
        programarEnvio()
        _state.update { it.copy(mensaje = "Envío solicitado. Si hay internet, se manda en unos segundos.") }
    }
}

class ObservationsViewModelFactory(
    private val catalogRepository: CatalogRepository,
    private val observationRepository: ObservationRepository,
    private val locationProvider: LocationProvider,
    private val cache: CatalogCache,
    private val programarEnvio: () -> Unit,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return ObservationsViewModel(catalogRepository, observationRepository, locationProvider, cache, programarEnvio) as T
    }
}