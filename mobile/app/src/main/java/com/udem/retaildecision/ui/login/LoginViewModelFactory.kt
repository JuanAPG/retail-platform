package com.udem.retaildecision.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.udem.retaildecision.data.repository.AuthRepository

/**
 * Jetpack no sabe construir un ViewModel con argumentos en el constructor
 * (AuthRepository) a menos que le demos esta fábrica explícita. Es
 * boilerplate necesario sin un framework de inyección de dependencias
 * (Hilt/Koin) — algo a evaluar si el proyecto crece y esto se repite mucho.
 */
class LoginViewModelFactory(private val authRepository: AuthRepository) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return LoginViewModel(authRepository) as T
    }
}
