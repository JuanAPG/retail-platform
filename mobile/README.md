# Retail Decision — App Móvil (Android)

Kotlin nativo + Jetpack Compose + Retrofit (**solo JSON**) + Room (offline) + WorkManager (envío en segundo plano) +
CameraX/ML Kit (escaneo) + Play Services Location (GPS). Usuario principal: `Investigador de mercado` (D-28).

## Servicios que consume

| Servicio | Puerto local | Para qué | Archivo |
|---|---|---|---|
| auth-service | 3101 | Login, renovación de token, logout | `data/remote/AuthApi.kt` |
| catalog-service | 3102 | Productos, presentaciones, tiendas, zonas, propuestas del Proveedor | `data/remote/CatalogApi.kt` |
| pricing-service | 3103 | Historial y comparación de precios, propuestas de precio, cola de precios de campo | `data/remote/PricingApi.kt` |
| offline-sync-service | 3118 | Lotes de capturas de campo y acuse por captura (D-42) | `data/remote/SyncApi.kt` |

Las URLs van en `BuildConfig`, una por variante (ver abajo). `ApiClient.kt` arma un Retrofit por servicio con el
mismo cliente HTTP (token, `Accept: application/json`, renovación por 401).

## Capturas en tienda y sincronización (D-42)

Contrato: `docs/contratos/offline-sync-service.md` (versión 1.0).

- Tipos de la versión 1.0: `precio_observado` (Investigador, Analista, Responsable de precios) y `disponibilidad`
  (Investigador, Analista). La pantalla solo ofrece los que el rol puede enviar (`TipoCaptura.permitidosPara`).
- Cada captura se guarda en Room con su **folio** (`captureId`, UUID del teléfono) y su hora **con zona horaria**
  (`capturedAt`). Ninguno de los dos cambia: ni al reintentar ni al cerrar la app.
- `SyncWorker` (WorkManager, solo con red) delega en `Sincronizador`, que arma lotes de hasta 100 capturas y los manda
  a `POST /v1/sync/batches`. El lote se guarda **antes** de enviarlo (`LoteEnCursoPrefs`): si la respuesta se pierde,
  el reintento manda el mismo lote (mismo `batchId`, mismos bytes) y el servidor devuelve el acuse sin duplicar.
- Qué pasa con cada resultado:

| Acuse o respuesta | En el teléfono |
|---|---|
| `aceptada`, `duplicada` (de una aceptada) | Enviada |
| `conflicto` | Queda con su motivo; no se reintenta |
| `rechazada` con `retryable: true` | Sigue pendiente; se reenvía con el mismo folio |
| `rechazada` definitiva | Queda con su motivo, visible en la lista |
| `401`, `429`, `5xx`, sin red | Todo el lote sigue pendiente; WorkManager reintenta |
| `409` | Reintenta el mismo lote; al tercero lo rearma con otro `batchId` (mismos folios) |
| `413` | Parte el lote a la mitad |
| `400`, `403` | Cada captura del lote queda rechazada con el mensaje del servidor |

- Solo se envían las capturas de quien tiene la sesión (`userId` en la fila).
- Base de datos versión 2: la migración 1 → 2 (`data/local/Migraciones.kt`) conserva todo lo guardado y le da folio a
  cada fila existente.

**Simulado hoy:** offline-sync-service todavía no entrega a availability ni a pricing (su destino es un simulador
mientras se acuerda el mapeo con Pamela, contrato §6). Una captura aceptada no aparece aún en esos servicios.

## Variantes y URLs

| Variante | URLs | HTTP plano |
|---|---|---|
| `debug` | `http://10.0.2.2:31xx/` (el `localhost` de tu máquina visto desde el emulador) | Permitido |
| `release` (entrega) | HTTPS; hoy son marcadores `https://<servicio>.PENDIENTE-GCP.invalid/` | Prohibido |

Las URLs de `release` se llenan sin tocar código, en `mobile/gradle.properties` o al compilar:

```
retail.release.authUrl=https://...
retail.release.catalogUrl=https://...
retail.release.pricingUrl=https://...
retail.release.syncUrl=https://...
```

El build de `release` **falla** si alguna no es `https://`, apunta a `10.0.2.2`/`localhost` o lleva puerto.
Con un teléfono físico en `debug`, cambia `10.0.2.2` por la IP de tu máquina en `urlsLocales` de `app/build.gradle.kts`.

## Compilar y probar

Abre esta carpeta con Android Studio (genera el wrapper de Gradle si falta) o usa Gradle 8.7 con JDK 17–21:

```
gradle assembleRelease        # variante de entrega (sin firmar)
gradle testDebugUnitTest      # pruebas unitarias en la JVM, sin emulador
```

Pruebas (`app/src/test`): `SincronizadorTest` (cada estado del acuse, cada código HTTP, folio estable, respuesta
perdida), `NuevaCapturaTest` (folio y hora con zona), `MigracionTest` (migración 1 → 2 contra SQLite real y contra el
esquema que genera Room) y `RolesYMenuTest`.

## Fuera de la versión 1.0 (PENDIENTE en el contrato)

- Visitas de campo: ubicación de la visita y respuestas de encuesta (D-30).
- Propuesta de producto desde campo cuando el código de barras no existe (D-32).
