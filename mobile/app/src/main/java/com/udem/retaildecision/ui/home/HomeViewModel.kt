package com.udem.retaildecision.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.local.ConnectivityObserver
import com.udem.retaildecision.data.repository.AuthRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class HomeViewModel(
    private val authRepository: AuthRepository,
    connectivityObserver: ConnectivityObserver,
) : ViewModel() {

    val nombre: String = authRepository.currentNombre() ?: "Usuario"
    val rol: String? = authRepository.currentRole()
    val secciones: List<SeccionMovil> = seccionesParaRol(rol)

    /** true = hay internet. Se actualiza solo cuando el teléfono gana o pierde conexión. */
    val online: StateFlow<Boolean> = connectivityObserver.observe()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), connectivityObserver.isOnline())

    /** Cierra sesión (avisa al servidor y borra la sesión local) y luego ejecuta `alTerminar`. */
    fun logout(alTerminar: () -> Unit) {
        viewModelScope.launch {
            authRepository.logout()
            alTerminar()
        }
    }
}

class HomeViewModelFactory(
    private val authRepository: AuthRepository,
    private val connectivityObserver: ConnectivityObserver,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return HomeViewModel(authRepository, connectivityObserver) as T
    }
}