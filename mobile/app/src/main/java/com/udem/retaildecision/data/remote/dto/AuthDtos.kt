package com.udem.retaildecision.data.remote.dto

/** Body que se manda a POST /v1/auth/login. */
data class LoginRequest(
    val email: String,
    val password: String,
)

/** Body que se manda a POST /v1/auth/refresh. */
data class RefreshRequest(
    val refreshToken: String,
)

/** auth-service anida los datos del usuario bajo "usuario". */
data class UsuarioDto(
    val id: String,
    val nombre: String,
    val email: String,
    val rolId: Int,
    val rol: String,
    val activo: Boolean,
)

/** Login siempre devuelve access + refresh y el usuario. */
data class LoginResponse(
    val accessToken: String,
    val refreshToken: String,
    val usuario: UsuarioDto,
)

/** POST /v1/auth/refresh devuelve el mismo par, rotado. */
data class RefreshResponse(
    val accessToken: String,
    val refreshToken: String,
)

/** Forma estándar de error: {statusCode, message, code, details, path, timestamp}. */
data class ApiErrorResponse(
    val statusCode: Int,
    val message: String,
    val code: String? = null,
    val details: Any? = null,
    val path: String? = null,
    val timestamp: String? = null,
)