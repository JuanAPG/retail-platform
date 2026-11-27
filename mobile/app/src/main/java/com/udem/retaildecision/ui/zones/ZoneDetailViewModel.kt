package com.udem.retaildecision.ui.zones

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.remote.dto.ZoneDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ZoneDetailUiState(
    val zonaId: String,
    /** null si la zona no está en la copia del teléfono (no debería pasar: se llega desde la lista). */
    val zona: ZoneDto?,
    val permisos: PermisosZona,
    val cargandoTiendas: Boolean = true,
    val tiendas: List<StoreDto> = emptyList(),
    val tiendasDesdeCopia: Boolean = false,
    val errorTiendas: String? = null,
    val ingreso: Indicador<NivelIngreso> = if (permisos.veIngreso) Indicador.Cargando else Indicador.Oculto,
    val cobertura: Indicador<String> = if (permisos.veCobertura) Indicador.Cargando else Indicador.Oculto,
) {
    val veIndicadores: Boolean get() = permisos.veIngreso || permisos.veCobertura
}

class ZoneDetailViewModel(
    zonaId: String,
    zona: ZoneDto?,
    permisos: PermisosZona,
    private val cargador: CargadorDetalleZona,
) : ViewModel() {

    private val _state = MutableStateFlow(ZoneDetailUiState(zonaId = zonaId, zona = zona, permisos = permisos))
    val state: StateFlow<ZoneDetailUiState> = _state.asStateFlow()

    init {
        cargar()
    }

    /** Las tres partes se piden a la vez y cada una se pinta al llegar; la falla de una no detiene a las otras. */
    fun cargar() {
        val id = _state.value.zonaId
        val permisos = _state.value.permisos
        _state.update {
            it.copy(
                cargandoTiendas = true,
                errorTiendas = null,
                ingreso = if (permisos.veIngreso) Indicador.Cargando else Indicador.Oculto,
                cobertura = if (permisos.veCobertura) Indicador.Cargando else Indicador.Oculto,
            )
        }
        viewModelScope.launch {
            val (tiendas, desdeCopia, error) = cargador.tiendas(id)
            _state.update {
                it.copy(
                    cargandoTiendas = false,
                    tiendas = tiendas.orEmpty(),
                    tiendasDesdeCopia = desdeCopia,
                    errorTiendas = error,
                )
            }
        }
        viewModelScope.launch {
            val ingreso = cargador.ingreso(id)
            _state.update { it.copy(ingreso = ingreso) }
        }
        viewModelScope.launch {
            val cobertura = cargador.cobertura(id)
            _state.update { it.copy(cobertura = cobertura) }
        }
    }
}

class ZoneDetailViewModelFactory(
    private val zonaId: String,
    private val zona: ZoneDto?,
    private val permisos: PermisosZona,
    private val cargador: CargadorDetalleZona,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return ZoneDetailViewModel(zonaId, zona, permisos, cargador) as T
    }
}
