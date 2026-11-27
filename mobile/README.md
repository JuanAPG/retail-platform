# Retail Decision — App Móvil (Android)

Kotlin nativo + Jetpack Compose + Retrofit (**solo JSON**) + Room (offline) + WorkManager (envío en segundo plano) +
CameraX/ML Kit (escaneo) + Play Services Location (GPS). Usuario principal: `Investigador de mercado` (D-28).

## Servicios que consume

| Servicio | Puerto local | Para qué | Archivo |
|---|---|---|---|
| auth-service | 3101 | Login, renovación de token, logout | `data/remote/AuthApi.kt` |
| catalog-service | 3102 | Productos, presentaciones, tiendas, zonas, propuestas del Proveedor | `data/remote/CatalogApi.kt` |
| pricing-service | 3103 | Historial y comparación de precios, propuestas de precio, cola de precios de campo | `data/remote/PricingApi.kt` |
| income-segmentation-service | 3112 | Nivel de ingreso vigente de cada zona (solo los 6 perfiles internos) | `data/remote/SegmentationApi.kt` |
| availability-service | 3114 | Cobertura de básicos de la zona (solo los 6 perfiles internos) | `data/remote/AvailabilityApi.kt` |
| offline-sync-service | 3118 | Lotes de capturas de campo y acuse por captura (D-42) | `data/remote/SyncApi.kt` |

Las URLs van en `BuildConfig`, una por variante (ver abajo). `ApiClient.kt` arma un Retrofit por servicio con el
mismo cliente HTTP (token, `Accept: application/json`, renovación por 401).

## Zonas y Detalle de zona

Pestaña "Zonas" del catálogo (`ui/catalog/CatalogScreen.kt`) y pantalla "Detalle de zona" (`ui/zones/`).

- **Tarjeta de zona:** nombre, municipio, descripción, estado, número de tiendas activas ("4 tiendas") y, solo para
  los 6 perfiles internos, una insignia de nivel de ingreso (bajo, medio o alto) según su clasificación vigente.
  Se toca para abrir el detalle.
- **Detalle:** encabezado de la zona; para los 6 internos, nivel de ingreso y "Cobertura de básicos: X %"
  (`disponible: false` se muestra como "Sin datos vigentes", nunca como 0 %); lista de tiendas de la zona
  (`GET /v1/stores?zonaId=`) con formato, sucursal y dirección. Cada tienda tiene "Capturar aquí" (abre Capturas en
  tienda con esa tienda elegida) solo para los roles que capturan, y "Ver en mapa" solo si trae latitud y longitud.
- **Qué ve cada rol** (`permisosZona` en `ui/zones/ZonaLogica.kt`):

| Rol | Tiendas | Nivel de ingreso y cobertura | Capturar aquí |
|---|---|---|---|
| Investigador de mercado | Sí | No: ni se piden (income-segmentation y availability le responden 403, D-28) | Sí |
| Analista comercial, Responsable de precios | Sí | Sí | Sí |
| Administrador, Gerente de categoría, Planeador, Auditor | Sí | Sí | No |

- **Sin internet:** zonas y tiendas (la lista general y la de cada zona) se guardan en el teléfono (`CatalogCache`)
  y el detalle funciona con esa copia. El nivel de ingreso y la cobertura no se guardan: sin red se ocultan con
  "No disponible sin conexión", y si el servicio falla, con "No disponible por ahora". La pantalla nunca se cae por
  esas dos lecturas.

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
- **Escáner → captura:** al encontrar un código, el escáner ofrece "Capturar precio" y/o "Capturar existencia", solo
  los tipos que el rol puede enviar (Investigador y Analista: los dos; Responsable de precios: precio; los demás:
  ninguno). El Investigador sigue sin ver precios en el escáner (D-28). Capturas en tienda abre con producto,
  presentación y tipo elegidos, muestra en solo lectura producto, presentación, SKU y código, y preselecciona la
  última tienda que **ese usuario** usó (`UltimaTiendaPorUsuario`, guardada en el teléfono por `userId`).
- **Botón "Escanear" en Capturas en tienda:** lee con la cámara y elige el producto y la presentación. Si el código no
  está en el catálogo: "Código no encontrado en el catálogo" y el formulario queda igual. Sin internet busca en el
  catálogo guardado en el teléfono.
- El SKU y el código de barras se guardan **solo** en `payloadJson`, para la lista del teléfono. El lote a
  offline-sync no cambia: lleva únicamente `captureId`, `type`, `contractVersion`, `capturedAt`, `storeId`,
  `presentationId` y `content` (prueba `LoteConEscaneoTest`).
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
retail.release.segmentationUrl=https://...
retail.release.availabilityUrl=https://...
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
esquema que genera Room), `RolesYMenuTest`, `ZonaDetalleTest` (qué ve cada rol en Zonas, formato de tienda y
dirección, cobertura sin datos, detalle sin red) y `ZoneInsightsRepositoryTest` (404, sin red, 401, `disponible: false`,
paginación), `EscanerCapturaTest` (botones de captura por rol, búsqueda del código), `RellenoCapturaTest` (formulario
lleno desde el escáner, código no encontrado, última tienda por usuario) y `LoteConEscaneoTest` (el lote no cambia).

## Fuera de la versión 1.0 (PENDIENTE en el contrato)

- Visitas de campo: ubicación de la visita y respuestas de encuesta (D-30).
- Propuesta de producto desde campo cuando el código de barras no existe (D-32).
