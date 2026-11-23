# Retail Decision — App Móvil (Android)

Kotlin nativo + Jetpack Compose + Retrofit (JSON) + Room (offline) + CameraX/ML Kit (escaneo) + Play Services Location (GPS).

## Cómo abrirlo

1. Abre esta carpeta (`mobile-app/`) directamente con **Android Studio** (Open → selecciona la carpeta). Android Studio detecta el `settings.gradle.kts` y genera el wrapper de Gradle automáticamente si falta.
2. Deja que sincronice (puede tardar la primera vez, descarga dependencias).
3. Corre en un emulador (`http://10.0.2.2:3000/` ya apunta al `localhost:3000` de tu máquina, que es donde normalmente expones el API Gateway / decision-service vía `docker compose`).

## Qué ya funciona

- Login contra `auth-service` (`POST /v1/auth/login`), con validación de formulario y manejo de error estandarizado.
- Token guardado cifrado (`EncryptedSharedPreferences`), logout que borra la sesión local.
- Cliente Retrofit único con `Accept: application/json` fijo en todas las peticiones (la app habla SOLO JSON, por requisito).
- Base de datos local (Room) para guardar visitas sin conexión (RF-38) y un `SyncWorker` (WorkManager) listo para engancharse a RF-39.
- Permisos declarados para cámara (RF-34) y ubicación (RF-37); falta implementar las pantallas que los usan.

## Qué falta (próximos incrementos)

- Pantalla de escaneo de código de barras (CameraX + ML Kit) conectada a `catalog-service`.
- Captura de ubicación GPS al registrar una visita.
- Menú según rol, pantallas de catálogo/precios/registro de transacciones.
- Conectar `SyncWorker` al endpoint real de `core-process-service` en cuanto el equipo confirme el contrato.
- Indicador de conectividad visible en la UI (ya existe `ConnectivityObserver`, falta pintarlo).

## Ajustar la URL del backend

`API_BASE_URL` está en `app/build.gradle.kts` (`buildConfigField`). Si pruebas contra un dispositivo físico en la misma red, cámbialo a la IP de tu máquina (ej. `http://192.168.1.50:3000/`) en vez de `10.0.2.2` (que solo funciona en el emulador).
