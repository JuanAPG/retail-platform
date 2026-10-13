package com.udem.retaildecision.data.repository

import com.google.gson.Gson
import com.udem.retaildecision.data.local.TokenManager
import com.udem.retaildecision.data.remote.AuthApi
import com.udem.retaildecision.data.remote.dto.ApiErrorResponse
import com.udem.retaildecision.data.remote.dto.LoginRequest
import com.udem.retaildecision.data.remote.dto.RefreshRequest

sealed class AuthResult {
    data object Success : AuthResult()
    data class Error(val message: String, val statusCode: Int?) : AuthResult()
}

/**
 * Capa intermedia entre la UI y Retrofit. La UI nunca llama a Retrofit
 * directo: siempre pasa por aquí.
 */
class AuthRepository(
    private val authApi: AuthApi,
    private val tokenManager: TokenManager,
) {
    private val gson = Gson()

    suspend fun login(email: String, password: String): AuthResult {
        return try {
            val response = authApi.login(LoginRequest(email, password))
            if (response.isSuccessful) {
                val body = response.body()
                if (body != null) {
                    tokenManager.saveSession(
                        accessToken = body.accessToken,
                        refreshToken = body.refreshToken,
                        userId = body.usuario.id,
                        nombre = body.usuario.nombre,
                        email = body.usuario.email,
                        rolId = body.usuario.rolId,
                        rol = body.usuario.rol,
                    )
                    AuthResult.Success
                } else {
                    AuthResult.Error("Respuesta vacía del servidor", response.code())
                }
            } else {
                AuthResult.Error(parseErrorMessage(response.errorBody()?.string()), response.code())
            }
        } catch (e: Exception) {
            AuthResult.Error("No se pudo conectar con el servidor: ${e.message}", null)
        }
    }

    /**
     * Renueva el par de tokens usando el refresh guardado. auth-service rota
     * ambos, así que SIEMPRE hay que guardar los dos que regresan.
     */
    suspend fun refreshSession(): Boolean {
        val refreshToken = tokenManager.getRefreshToken() ?: return false
        return try {
            val response = authApi.refresh(RefreshRequest(refreshToken))
            val body = response.body()
            if (response.isSuccessful && body != null) {
                tokenManager.updateTokens(body.accessToken, body.refreshToken)
                true
            } else {
                false
            }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun logout() {
        try {
            authApi.logout()
        } catch (e: Exception) {
            // Si el logout remoto falla (sin red), igual borramos la sesión local.
        } finally {
            tokenManager.clearSession()
        }
    }

    fun isLoggedIn(): Boolean = tokenManager.isLoggedIn()
    fun currentRole(): String? = tokenManager.getUserRole()
    fun currentNombre(): String? = tokenManager.getUserNombre()

    private fun parseErrorMessage(errorBody: String?): String {
        val parsed = runCatching { gson.fromJson(errorBody, ApiErrorResponse::class.java) }.getOrNull()
        return parsed?.message ?: "Credenciales inválidas"
    }
}