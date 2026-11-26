# Contrato: registro de archivo privado y adaptador de almacenamiento (versión 1)

Propone: Pamela (documents-service). Lo reutiliza Juan Ángel en `transactions-ingestion-service`
(3111) para los lotes. **Cada dominio guarda su propio registro y aplica sus propios permisos**;
lo que se comparte es la forma del registro, la convención de rutas y el adaptador.

Implementación de referencia: `services/documents-service/src/reports/archivos/`
(adaptador en `almacen/`, registro en `archivo.schema.ts`).

## 1. Registro de archivo

Colección MongoDB `archivos` del servicio dueño (en documents: base `retaildb`). Un registro por
**recurso y formato** (índice único `dominio + recursoTipo + recursoId + formato`).

| Campo | Tipo | Regla |
|---|---|---|
| `id` | UUID v4 | Lo genera el servicio. Es lo único que se publica para pedir la descarga. |
| `versionContrato` | entero | `1`. Sube si cambia la forma del registro. |
| `dominio` | texto | `reportes` (documents), `ingesta` (3111). |
| `recursoTipo` / `recursoId` | texto | `reporte` + id del reporte; `lote` + id del lote. |
| `formato` | texto | documents: `pdf`, `xlsx`, `csv`. |
| `almacen` | texto | `gcs` o `local` (doble de pruebas). |
| `bucket` | texto | Nombre del bucket. Con el doble local vale `local` (la carpeta no se publica). |
| `ruta` | texto o `null` | Ruta del objeto, **generada por el servicio**, nunca el nombre que sube el usuario. `null` hasta que hay objeto. |
| `tipoContenido` | texto | MIME real del contenido generado (no el que declare el cliente). |
| `tamanoBytes` | entero o `null` | El que reporta el almacén **después** de subir; debe coincidir con lo subido. |
| `sha256` | 64 hex o `null` | Hash del contenido subido. |
| `propietarioId` | texto | Dueño del recurso. Con esto decide el dominio el acceso de quien solo ve lo propio. |
| `solicitadoPor` | texto | Quien pidió el archivo (no se publica; recibe el aviso). |
| `privacidad` | texto | Siempre `privado`. No hay objetos públicos. |
| `estado` | `pendiente` \| `disponible` \| `fallido` | Ver §2. |
| `intentos` | entero | Subidas intentadas. |
| `ultimoError` | texto o `null` | Motivo del último fallo, sin URLs, firmas ni tokens. |
| `urlsEmitidas` / `lecturas` | enteros | URLs firmadas emitidas / lecturas efectivas vistas (ver §4). |
| `correlationId` | texto o `null` | `X-Correlation-Id` de la petición que lo creó (T-02). |
| `metadatos` | objeto | Del dominio. documents: `reporteCreadoEn`, `tipoReporte`, `indicadoresNoDisponibles`, `generacion`. |
| `creadoEn` / `actualizadoEn` / `disponibleEn` | fecha ISO 8601 UTC | `disponibleEn` solo cuando el objeto se verificó. |

Campos internos que no se publican: `enCursoHasta` (candado de generación), `avisoEmitidoEn`
(aviso único), `solicitadoPor`.

## 2. Estados y reglas

```
(nuevo) ──► pendiente ──(objeto subido Y verificado)──► disponible
               │                                          │
               └──(almacén falla)──► fallido ◄──(objeto ya no está)──┘
                                        │
                                        └──(misma petición)──► pendiente (reintento)
```

1. **Nunca se anuncia un archivo que no existe.** `disponible` se pone solo después de que el
   almacén confirma el objeto con el tamaño subido. Antes de firmar una URL se vuelve a comprobar;
   si el objeto ya no está, el registro pasa a `fallido` y se responde `409`.
2. **Reintento seguro.** Cada intento sube a una ruta nueva (`…/<id>-<intento>.<ext>`) con
   `ifGenerationMatch: 0`: un reintento nunca sobrescribe un objeto a medias. Un candado de 60 s
   (`enCursoHasta`) evita dos subidas simultáneas; quien llega mientras otra corre recibe `202`.
3. **Aviso único.** El aviso "ya se puede descargar" se reclama atómicamente
   (`avisoEmitidoEn: null → ahora`); si notifications lo rechaza se libera para reintentarlo.
   Reintentar o regenerar un archivo ya avisado no avisa de nuevo.
4. **Fallo del almacén = 503 `SERVICE_UNAVAILABLE`**, registro `fallido` con el motivo y la
   operación de reporte intacta. Al volver el almacén, la misma petición lo deja `disponible`.

## 3. Convención de rutas

```
<dominio>/<AAAA>/<MM>/<recursoId>/<archivoId>-<intento>.<ext>
reportes/2026/10/6705f1c2a3b4c5d6e7f80912/3f0c9a8e-…-1.pdf
ingesta/2026/11/<loteId>/<archivoId>-1.csv
```

`AAAA/MM` es la fecha del recurso (UTC). Metadatos del objeto en GCS: `archivoId`, `recursoId`,
`sha256`, `correlationId`; `Cache-Control: private, no-store`.

## 4. URL firmada y bitácora

- Se emite **después** de autorizar: rol según la Matriz y propiedad del recurso. Recurso ajeno
  para quien solo ve lo propio → `404`, no `403`.
- **TTL: 300 s por defecto, tope 900 s** (`ARCHIVOS_URL_TTL_SEGUNDOS`). *Propuesta de política para
  cerrar con el equipo.* Es tiempo para que el navegador empiece la descarga, no un enlace para compartir.
- La URL **no se guarda, no se escribe en logs ni en la bitácora**. Los logs enmascaran
  `sig`, `token` y `X-Goog-*` del query.
- Bitácora: **"URL emitida"** (audit-service, `accion: exportar`, con quién, cuándo, formato y
  vencimiento) es distinto de **"objeto leído"**. En GCS la lectura queda en Cloud Audit Logs
  (Data Access de Cloud Storage, que hay que **activar** en el proyecto) y se correlaciona por
  la ruta del objeto y la hora. Con el doble local, la lectura incrementa `lecturas` y deja un
  log `objeto_leido` sin la firma.

## 5. Adaptador (`AlmacenObjetos`)

```ts
interface AlmacenObjetos {
  tipo: 'gcs' | 'local';
  bucket: string;
  guardar(ruta, contenido: Buffer, tipoContenido, metadatos): Promise<{ tamanoBytes; generacion }>;
  tamano(ruta): Promise<number | null>;          // null = no existe; lanza si el almacén no responde
  firmarLectura(ruta, { ttlSegundos, nombreDescarga, tipoContenido, archivoId }): Promise<{ url; expiraEn }>;
  verificar(): Promise<string>;                  // 'ok' o 'error: …'; nunca lanza (va al health)
}
```

- SDK: `@google-cloud/storage` **7.x** (probado con 7.22). Firma URL **V4**, acción `read`, con
  `responseDisposition` (nombre de descarga) y `responseType`.
- Timeout por operación: `GCS_TIMEOUT_MS` (10 s); el health consulta el bucket con 2 s y guarda el
  resultado 30 s.
- Errores: cualquier fallo del almacén se lanza como `AlmacenNoDisponibleError` (→ 503); un 404 de
  GCS en `tamano` es `null`, no error.

### Variables

| Variable | Dónde | Valor |
|---|---|---|
| `ARCHIVOS_ALMACEN` | todos | `local` (default) o `gcs`. Con `gcs` sin bucket el servicio **no arranca**. |
| `GCS_BUCKET_REPORTES` | staging/prod | Bucket privado de reportes. |
| `GCS_PROJECT_ID` | opcional | Si la identidad no lo trae. |
| `GOOGLE_APPLICATION_CREDENTIALS` | solo local con GCS real | Ruta a una llave; **en GCP no se usa** (identidad del servicio). |
| `ARCHIVOS_URL_TTL_SEGUNDOS` | opcional | 300 por defecto, tope 900. |
| `GCS_TIMEOUT_MS` | opcional | 10000. |
| `ARCHIVOS_DIR_LOCAL` | local | Carpeta del doble (default `<tmp>/retail-archivos`). |
| `ARCHIVOS_FIRMA_LOCAL_SECRET` | local | Secreto HMAC del doble; sin él, uno aleatorio por proceso. |
| `ARCHIVOS_URL_BASE_PUBLICA` | local | Base de las URLs del doble (default `http://localhost:<PORT>`). |

### Permisos en GCP (para Juan Ángel / infraestructura)

- Bucket con *uniform bucket-level access*, *public access prevention* activado, sin `allUsers`.
- Cuenta de servicio de documents: `roles/storage.objectCreator` y `roles/storage.objectViewer`
  sobre el bucket, y `roles/iam.serviceAccountTokenCreator` **sobre sí misma** (firma V4 sin llave
  vía `signBlob`).
- Recomendado: regla de ciclo de vida que borre objetos de intentos fallidos huérfanos (> 7 días
  sin registro `disponible`), y activar los Data Access logs de Cloud Storage.

## 6. Rutas de documents-service

| Ruta | Rol (Matriz M16) | Respuesta |
|---|---|---|
| `POST /v1/reports/:id/files` `{ "format": "pdf" }` | `LEEN_REPORTES` (6 internos + Proveedor solo propios) | `201` generado · `200` ya disponible · `202` en curso · `503` almacén caído |
| `GET /v1/reports/:id/files` | igual | `{ data: [archivo…] }` |
| `GET /v1/reports/:id/files/:fileId` | igual | archivo (para consultar el estado) |
| `POST /v1/reports/:id/files/:fileId/download-url` | igual | `{ archivoId, url, expiraEn, ttlSegundos, nombre, tipoContenido, tamanoBytes, sha256 }` · `409` si no está disponible |

**Nuevas** en el Sprint 4/Parcial 3. Siguen igual (compatibilidad): `GET /v1/reports/:id/export?format=`
descarga directa. XML: raíces `fileResponse`, `fileListResponse`, `downloadUrlResponse` en
`documents-service.xsd` (namespace `documents/v1`). Errores con el formato estándar.

### Ejemplos

Petición y respuesta JSON (201):

```json
POST /v1/reports/6705f1c2a3b4c5d6e7f80912/files
{ "format": "pdf" }

{
  "id": "3f0c9a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f", "versionContrato": 1,
  "dominio": "reportes", "recursoTipo": "reporte", "recursoId": "6705f1c2a3b4c5d6e7f80912",
  "formato": "pdf", "almacen": "gcs", "bucket": "retail-staging-reportes",
  "ruta": "reportes/2026/10/6705f1c2a3b4c5d6e7f80912/3f0c9a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f-1.pdf",
  "tipoContenido": "application/pdf", "tamanoBytes": 48213,
  "sha256": "9b74c9897bac770ffc029102a200c5de2f1b1f4d1d0a6a4c7b8e1f0c2d3e4f5a",
  "propietarioId": "a8e46052-34a0-4dda-baf2-40bca267454f", "privacidad": "privado",
  "estado": "disponible", "intentos": 1, "ultimoError": null, "urlsEmitidas": 0, "lecturas": 0,
  "correlationId": "5d1e2c3b-0a9f-4e8d-b7c6-1f2e3d4c5b6a",
  "metadatos": { "reporteCreadoEn": "2026-10-08T18:00:00.000Z", "tipoReporte": "ejecutivo", "indicadoresNoDisponibles": 1 },
  "creadoEn": "2026-10-08T18:01:00.000Z", "actualizadoEn": "2026-10-08T18:01:02.000Z",
  "disponibleEn": "2026-10-08T18:01:02.000Z"
}
```

XML (`Accept: application/xml`, mismos datos; los nulos se omiten):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<downloadUrlResponse xmlns="documents/v1">
  <archivoId>3f0c9a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f</archivoId>
  <url>https://storage.googleapis.com/retail-staging-reportes/reportes/…</url>
  <expiraEn>2026-10-08T18:06:02.000Z</expiraEn>
  <ttlSegundos>300</ttlSegundos>
  <nombre>reporte-ejecutivo-2026-10-08.pdf</nombre>
  <tipoContenido>application/pdf</tipoContenido>
  <tamanoBytes>48213</tamanoBytes>
  <sha256>9b74c9897bac770ffc029102a200c5de2f1b1f4d1d0a6a4c7b8e1f0c2d3e4f5a</sha256>
</downloadUrlResponse>
```

Rechazos:

```json
// Almacén caído
{ "statusCode": 503, "code": "SERVICE_UNAVAILABLE", "details": null,
  "message": "El almacén de archivos no está disponible; el archivo 3f0c… quedó como fallido y se puede reintentar con la misma petición.",
  "path": "/v1/reports/6705…/files", "timestamp": "2026-10-08T18:01:00.000Z" }

// Proveedor con el reporte de otro
{ "statusCode": 404, "code": "NOT_FOUND", "message": "El reporte no existe.", "details": null, "path": "…", "timestamp": "…" }

// URL de un archivo que no está disponible
{ "statusCode": 409, "code": "CONFLICT", "message": "El archivo todavía no está disponible (estado: fallido).", "details": null, "path": "…", "timestamp": "…" }
```

## 7. Aviso de "archivo disponible" (para T-20, Juan Ángel)

Propuesta de evento nuevo en el catálogo cerrado de notifications-service:

| Evento | Puede originarlo | Le llega a | Copia a |
|---|---|---|---|
| `reporte.disponible` | los roles de `LEEN_REPORTES` (6 internos + Proveedor) | el usuario que pidió el archivo (`recipientUserId`) | — |

```json
{ "eventType": "reporte.disponible", "sourceService": "documents-service",
  "relatedEntityType": "reporte", "relatedEntityId": "6705f1c2a3b4c5d6e7f80912",
  "title": "Tu reporte ya se puede descargar",
  "message": "El reporte ejecutivo en PDF está listo para descargar.",
  "recipientUserId": "a8e46052-34a0-4dda-baf2-40bca267454f", "priority": "info" }
```

El dedup de 5 min de notifications no hace falta para este evento (documents ya avisa una sola vez
por archivo), pero no estorba. Mientras el evento no exista, notifications responde 400/403, documents
lo deja en el log y vuelve a intentar el aviso en la siguiente petición del archivo.

## 8. Pendiente de cerrar

- **TTL**: propuesta 300 s / tope 900 s (§4). Registrar como decisión.
- **P-06**: qué es un reporte "propio" del Proveedor. Hoy: el que tiene su `usuarioId`
  (`propietarioId` del archivo). Como solo el Gerente genera reportes, en la práctica un Proveedor
  no tiene reportes propios todavía; el caso de prueba usa uno sembrado.
- `reporte.disponible` en el catálogo de notifications (T-20).
