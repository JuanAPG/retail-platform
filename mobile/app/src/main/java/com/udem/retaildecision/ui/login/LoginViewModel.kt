package com.udem.retaildecision.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.udem.retaildecision.data.repository.AuthRepository
import com.udem.retaildecision.data.repository.AuthResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Estado inmutable que la pantalla observa y pinta; nunca lo muta directo. */
data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val loginSuccess: Boolean = false,
)

/**
 * El ViewModel sobrevive a cambios de configuración (ej. rotar la pantalla)
 * y es quien habla con el Repository — la pantalla (LoginScreen) nunca llama
 * directo a AuthRepository ni a Retrofit. Esto es lo que hace que la lógica
 * de login sea testeable sin tener que renderizar UI.
 */
class LoginViewModel(private val authRepository: AuthRepository) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onEmailChange(value: String) {
        _uiState.value = _uiState.value.copy(email = value, errorMessage = null)
    }

    fun onPasswordChange(value: String) {
        _uiState.value = _uiState.value.copy(password = value, errorMessage = null)
    }

    fun submit() {
        val state = _uiState.value

        // Validación de formulario (requisito explícito): no gastamos una
        // llamada de red con campos vacíos o un correo con formato inválido.
        if (state.email.isBlank() || state.password.isBlank()) {
            _uiState.value = state.copy(errorMessage = "Correo y contraseña son obligatorios")
            return
        }
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(state.email).matches()) {
            _uiState.value = state.copy(errorMessage = "El correo no tiene un formato válido")
            return
        }

        viewModelScope.launch {
            _uiState.value = state.copy(isLoading = true, errorMessage = null)
            when (val result = authRepository.login(state.email, state.password)) {
                is AuthResult.Success -> {
                    _uiState.value = _uiState.value.copy(isLoading = false, loginSuccess = true)
                }
                is AuthResult.Error -> {
                    _uiState.value = _uiState.value.copy(isLoading = false, errorMessage = result.message)
                }
            }
        }
    }
}
