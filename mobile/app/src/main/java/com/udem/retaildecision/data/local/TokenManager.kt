package com.udem.retaildecision.data.local

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Guarda access token, refresh token y el perfil mínimo del usuario, todo
 * cifrado con EncryptedSharedPreferences (AES-256, llave en el Android
 * Keystore). auth-service SIEMPRE emite los dos tokens juntos.
 */
class TokenManager(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "retail_decision_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun saveSession(
        accessToken: String,
        refreshToken: String,
        userId: String,
        nombre: String,
        email: String,
        rolId: Int,
        rol: String,
    ) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .putString(KEY_USER_ID, userId)
            .putString(KEY_NOMBRE, nombre)
            .putString(KEY_EMAIL, email)
            .putInt(KEY_ROL_ID, rolId)
            .putString(KEY_ROL, rol)
            .apply()
    }

    /** Solo actualiza los tokens tras un refresh exitoso; el perfil no cambia. */
    fun updateTokens(accessToken: String, refreshToken: String) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .apply()
    }

    fun getAccessToken(): String? = prefs.getString(KEY_ACCESS_TOKEN, null)
    fun getRefreshToken(): String? = prefs.getString(KEY_REFRESH_TOKEN, null)
    fun getUserRole(): String? = prefs.getString(KEY_ROL, null)
    fun getUserRoleId(): Int = prefs.getInt(KEY_ROL_ID, -1)
    fun getUserEmail(): String? = prefs.getString(KEY_EMAIL, null)
    fun getUserNombre(): String? = prefs.getString(KEY_NOMBRE, null)

    fun isLoggedIn(): Boolean = getAccessToken() != null

    /** Logout: borra credenciales locales, requisito explícito del backlog. */
    fun clearSession() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_USER_ID = "user_id"
        const val KEY_NOMBRE = "nombre"
        const val KEY_EMAIL = "email"
        const val KEY_ROL_ID = "rol_id"
        const val KEY_ROL = "rol"
    }
}