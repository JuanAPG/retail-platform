# Contrato: availability-service (T-05 · Sprint 4)

Base: `http://availability-service:3114` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`availability-service.xsd`, namespace `availability/v1`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}`. Listados paginados según
`paginacion.md`. Todas las rutas (menos `GET /v1/health`) requieren
`Authorization: Bearer <accessToken>` y sesión activa en Redis (`SessionGuard`).

Plantilla: `services/template-nest/` (con T-02: `X-Correlation-Id` y health con
dependencias). `GET /v1/health` sigue `health.xsd`.

Decisiones que aplica: **D-38** (la disponibilidad pasa a este servicio; faltante,
vigencia de 7 días y cobertura), **D-03** (canasta básica), **D-28** (el Investigador de
mercado da de alta disponibilidad) y **D-42** (una captura más vieja que el dato del
servidor no lo sobrescribe).

## Vocabulario

| Término | Significado |
|---|---|
| **Existencia** | Cuánto hay de una **presentación** en una **tienda** (`stock`, ≥ 0). |
| **Captura** | Un levantamiento de existencia: quién, cuándo y cuánto. Solo se anexan. |
| **Dato vigente** | Existencia capturada hace **7 días o menos**. Después es **vencido**: no cuenta como disponible ni como faltante. |
| **Básico** | Producto marcado `esCanastaBasica` en catalog-service (D-03). |
| **Básico cubierto** | Básico con **al menos una presentación** con existencia vigente mayor a 0 en la tienda. No importa cuál presentación ni cuál marca. |
| **Faltante** | Básico con dato vigente y existencia **0 en todas** sus presentaciones con dato vigente. Otro producto de la misma categoría **no** lo cubre (naranja no cubre manzana). |
| **Cobertura** | % de básicos cubiertos en la tienda. |

La **canasta básica** (qué debe haber) no es la **canasta típica** (qué se compra, D-37)
ni una **sustitución** (qué recomendar en su lugar): este servicio solo dice qué hay y
qué falta.

## Tablas (Postgres compartido; este servicio es el único que las escribe)

| Tabla | Estado | Contenido |
|---|---|---|
| `inventario` | Recibida de catalog (D-38) | Existencia **actual** por tienda y presentación. `actualizado_en` es la fecha en que se **capturó** el dato, no en la que se subió. |
| `disponibilidad_capturas` | Nueva | Bitácora de capturas (aceptadas y en conflicto), con su id de dispositivo. Solo se anexa. |

No usa MongoDB. Redis solo para la sesión (`SessionGuard`): la idempotencia de las
capturas la da la llave única de `disponibilidad_capturas`, no una llave de Redis.

## Permisos (Matriz §3.2)

| Admin | Analista | Gerente | Resp. precios | Planeador | Auditor | Proveedor | Investigador |
|---|---|---|---|---|---|---|---|
| L | **T** | L | L | L | L | – | Alta de capturas (D-28) |

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/availability/captures` | Investigador de mercado, Analista comercial |
| GET | `/v1/availability/captures` | Los 6 perfiles internos |
| GET | `/v1/availability/stock` | Los 6 perfiles internos |
| GET | `/v1/availability/stores/:storeId/coverage` | Los 6 perfiles internos |
| GET | `/v1/availability/zones/:zoneId/coverage` | Los 6 perfiles internos |
| GET | `/v1/availability/shortages` | Los 6 perfiles internos |

El Proveedor → `403` en todas. El Investigador de mercado solo **da de alta** capturas
(D-28); las lecturas → `403`. `:storeId`, `:zoneId` y todo id de tienda o presentación son
UUID; otro valor → `400`.

---

## Capturas

### POST /v1/availability/captures

Registra la existencia de una presentación en una tienda. La usan la app móvil (directo o
a través de `offline-sync-service`, D-42) y el Analista comercial para corregir un dato.

```json
{
  "captureId": "c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11",
  "storeId": "27f05c81-c6bf-456a-a273-150e4edb9900",
  "presentationId": "5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77",
  "stock": 12,
  "capturedAt": "2026-10-26T15:30:00.000Z",
  "origin": "movil"
}
```

| Campo | Regla |
|---|---|
| `captureId` | opcional, UUID **generado en el dispositivo** (D-42). Si no viene, el servidor genera uno |
| `storeId`, `presentationId` | obligatorios, UUID de una tienda y una presentación existentes (si no → `400`) |
| `stock` | obligatorio, numérico **≥ 0**, hasta 2 decimales. `0` = agotado |
| `capturedAt` | opcional, fecha y hora ISO 8601 en que se **vio** el dato; por defecto, ahora. En el futuro (más de 5 min) → `400` |
| `origin` | opcional: `movil` \| `escritorio` \| `web`; por defecto `web` |

Campos no listados → `400`.

Resultado (`captureResponse`):

```json
{
  "captureId": "c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11",
  "status": "aceptada",
  "storeId": "27f05c81-…",
  "presentationId": "5b0d6a0e-…",
  "stock": 12,
  "capturedAt": "2026-10-26T15:30:00.000Z",
  "receivedAt": "2026-10-30T09:02:11.000Z",
  "origin": "movil",
  "capturedBy": "uuid-del-usuario",
  "currentStock": 12,
  "currentCapturedAt": "2026-10-26T15:30:00.000Z",
  "reason": null
}
```

| `status` | HTTP | Qué pasó |
|---|---|---|
| `aceptada` | `201` | La captura es el dato más reciente de esa tienda y presentación: actualiza la existencia. |
| `conflicto` | `201` | El servidor ya tenía un dato **capturado después** (`currentCapturedAt` > `capturedAt`). La captura se guarda en la bitácora pero **no sobrescribe** (D-42). `reason` lo explica. |
| `duplicada` | `200` | Ese `captureId` ya se había recibido: no se crea nada y se devuelve el resultado original (reenviar un lote no duplica). |

- Lo que cuenta es **cuándo se capturó**, no cuándo se subió: una captura del lunes
  sincronizada el viernes pierde contra una del jueves.
- Dos capturas con el mismo `capturedAt`: gana la que llegó primero; la segunda queda en
  `conflicto`.
- `currentStock` / `currentCapturedAt` son la existencia que quedó en el servidor.
- `stock` y `currentStock` son números. `capturedBy` es solo el id (D-26).
- Un `captureId` ya usado por **otro** usuario → `409` (no se revela la captura ajena).

### GET /v1/availability/captures

Bitácora paginada, la más reciente (por `receivedAt`) primero. Query opcional: `storeId`,
`presentationId`, `status` (`aceptada` | `conflicto`). Response `200`:
`{ "data": [Capture], "total": n, "page": 1, "limit": 20 }` (`captureListResponse`).
Cada Capture tiene los campos de arriba menos `currentStock` y `currentCapturedAt`.

---

## Existencias

### GET /v1/availability/stock

Existencia actual por tienda y presentación. Paginado, orden: `capturedAt` descendente.
Query opcional: `storeId`, `presentationId`, `status`.

```json
{
  "data": [
    {
      "storeId": "27f05c81-…",
      "presentationId": "5b0d6a0e-…",
      "stock": 12,
      "capturedAt": "2026-10-26T15:30:00.000Z",
      "ageDays": 3,
      "status": "disponible"
    }
  ],
  "total": 1, "page": 1, "limit": 20
}
```

| `status` | Cuándo |
|---|---|
| `disponible` | Dato vigente y `stock` > 0 |
| `agotado` | Dato vigente y `stock` = 0 |
| `vencido` | El dato tiene **más de 7 días**: no se puede afirmar ni que hay ni que falta (D-38) |

- Vigente = capturado hace 7 días o menos, a la fecha y hora de la consulta
  (`ahora − capturedAt ≤ 7 × 24 h`). `ageDays` = días completos transcurridos.
- Un dato vencido conserva su `stock` para referencia, pero `status` es `vencido`.
- La vigencia sale de `AVAILABILITY_VALID_DAYS` (por defecto `7`, D-38).

XML: `stockListResponse`.

---

## Cobertura y faltantes

Los básicos y sus presentaciones se piden a catalog-service **por HTTP**
(`GET {CATALOG_SERVICE_URL}/v1/products`, solo activos con `esCanastaBasica: true`), y las
tiendas de una zona con `GET {CATALOG_SERVICE_URL}/v1/stores`; se reenvían el
`Authorization` y el `X-Correlation-Id`. Si catalog-service no responde en 3 s → `503`.

### Estado de un básico en una tienda

Se decide en este orden:

| Estado | Regla |
|---|---|
| `cubierto` | Alguna presentación tiene dato **vigente** con `stock` > 0 |
| `faltante` | Ninguna cubre, y hay al menos un dato **vigente** (todos en 0) |
| `vencido` | Solo hay datos vencidos |
| `sin_dato` | Nunca se ha capturado ninguna de sus presentaciones |

### GET /v1/availability/stores/:storeId/coverage

```json
{
  "storeId": "27f05c81-…",
  "validDays": 7,
  "basics": 4,
  "covered": 2,
  "missing": 1,
  "expired": 1,
  "noData": 0,
  "disponible": true,
  "coverage": 50,
  "motivo": null,
  "items": [
    { "productId": "uuid", "productName": "Frijol negro", "status": "cubierto",
      "presentationsWithStock": 1, "lastCapturedAt": "2026-10-28T10:00:00.000Z" }
  ]
}
```

- `coverage` = `covered / basics × 100`, redondeado a 2 decimales (D-38). Un básico
  `vencido` o `sin_dato` **no** cuenta como cubierto (no se puede afirmar que hay) ni como
  faltante.
- `disponible: false` con `motivo`, y **sin `coverage`** (nunca 0), cuando no se puede
  calcular: el catálogo no tiene básicos, o la tienda no tiene ningún dato vigente de
  ningún básico.
- `items`: un elemento por básico, ordenado por `productName`. `lastCapturedAt` es la
  captura más reciente entre sus presentaciones (`null` si `sin_dato`).
- Tienda inexistente → `404`.

**Caso de control** (prueba unitaria). Cuatro básicos, vigencia de 7 días:

| Básico | Datos en la tienda | Estado |
|---|---|---|
| Arroz | 1 kg con 5, capturado hoy | `cubierto` |
| Frijol | La Sierra con 0 y La Costeña con 3, ambos de ayer | `cubierto` |
| Leche | 1 L con 0, capturado hoy | `faltante` |
| Huevo | 12 pzas con 10, capturado hace 8 días | `vencido` |

Resultado: `basics 4`, `covered 2`, `missing 1`, `expired 1`, `noData 0`,
**`coverage 50`**.

XML: `storeCoverageResponse`.

### GET /v1/availability/zones/:zoneId/coverage

Cobertura de la zona: la usa decision-service para el componente de disponibilidad de la
accesibilidad (D-38) y para la regla de baja disponibilidad (D-13).

```json
{
  "zoneId": "f2670df2-…",
  "validDays": 7,
  "stores": 2,
  "basics": 4,
  "covered": 3,
  "disponible": true,
  "coverage": 75,
  "motivo": null,
  "items": [
    { "productId": "uuid", "productName": "Frijol negro", "status": "cubierto",
      "storesWithStock": 1, "storeShare": 50 }
  ],
  "byStore": [
    { "storeId": "27f05c81-…", "disponible": true, "coverage": 50, "covered": 2, "missing": 1 }
  ]
}
```

- Solo cuentan las tiendas **activas** de la zona. `stores` es cuántas son.
- Un básico está `cubierto` en la zona si lo está en **al menos una** tienda; `faltante`
  si ninguna lo cubre y alguna tiene dato vigente; `vencido` y `sin_dato` como arriba.
- `coverage` = `covered / basics × 100`, 2 decimales.
- `storesWithStock` = tiendas de la zona donde el básico está cubierto; `storeShare` =
  `storesWithStock / stores × 100`, 2 decimales (D-13: baja disponibilidad si < 50).
- `byStore`: resumen por tienda; `coverage` se omite donde no está disponible.
- `disponible: false` con `motivo` y sin `coverage`: zona sin tiendas activas, catálogo
  sin básicos, o ninguna tienda con dato vigente.
- Zona inexistente → `404`.

**Caso de control.** Los cuatro básicos de arriba y dos tiendas: la tienda A es la del
caso anterior; la tienda B solo tiene Leche 1 L con 8, capturada hoy. Zona: Arroz
`cubierto` (1 de 2 tiendas, `storeShare 50`), Frijol `cubierto` (50), Leche `cubierto`
(50), Huevo `vencido` (0). **`covered 3`, `coverage 75`.**

XML: `zoneCoverageResponse`.

### GET /v1/availability/shortages

Lista de faltantes. Exige **exactamente uno** de `storeId` o `zoneId` (ninguno o los dos →
`400`). **No se pagina** (acotado por el filtro obligatorio y por la canasta básica;
excepción de `paginacion.md`).

```json
{
  "storeId": "27f05c81-…",
  "validDays": 7,
  "data": [
    { "productId": "uuid", "productName": "Leche entera", "storeId": "27f05c81-…",
      "lastCapturedAt": "2026-10-29T12:00:00.000Z" }
  ]
}
```

Con `zoneId`, una fila por cada tienda de la zona donde el básico es `faltante`; la raíz
trae `zoneId` en lugar de `storeId`. Sin faltantes → `data: []`. Tienda o zona inexistente
→ `404`. XML: `shortageListResponse`.

---

## Auditoría

Cada captura `aceptada` se reporta a audit-service (`POST /v1/auditoria`,
`servicio: availability-service`, tabla `inventario`, acción `update`, con
`cambios: [{ campo: "stock_disponible", previo, posterior }]`) **después** de guardarla y
sin bloquear (timeout de 1.5 s). Una captura en `conflicto` se reporta como `insert` sobre
`disponibilidad_capturas`. Variable: `AUDIT_SERVICE_URL`.

No emite notificaciones: ninguna decisión define un aviso para estos eventos.

## Códigos de error

| Status | Cuándo |
|---|---|
| 400 | Cuerpo o query inválidos, campo desconocido, id no UUID, `stock` negativo, `capturedAt` futuro, tienda o presentación inexistente al capturar, `shortages` sin filtro o con los dos |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso sobre la ruta |
| 404 | Tienda o zona inexistente en cobertura y faltantes |
| 409 | `captureId` ya usado por otro usuario |
| 503 | catalog-service no responde; Redis sin responder al validar la sesión |

## Consecuencias para otros servicios y clientes (D-38)

No son parte de este contrato; las coordina cada dueño:

- **decision-service** hoy lee `inventario` por SQL en accesibilidad. Debe pasar a
  `GET /v1/availability/zones/:zoneId/coverage`. La columna que lee no cambia, así que
  sigue funcionando mientras migra.
- **offline-sync-service** (T-17) envía cada captura de disponibilidad a
  `POST /v1/availability/captures` con su `captureId` y traduce `status` a su acuse
  (`aceptada`, `duplicada`, `conflicto`; un `400` es `rechazada`).
- **catalog-service** conserva `PUT /v1/zones/:id/indicators` (carga manual del indicador
  de disponibilidad de la zona) y sus chequeos de historial antes de borrar (D-07), que
  solo cuentan filas.

## Por confirmar con el Product Owner

1. **Quién corrige existencias.** Se propone el Analista comercial (Total), porque la
   disponibilidad es insumo de la accesibilidad, que es suya (M12). Ninguna decisión lo
   fija.
2. **Detalle de la cobertura.** D-38 da la fórmula; este contrato agrega que un básico se
   cubre con cualquiera de sus presentaciones (acordado en la junta del 21-oct) y que un
   dato vencido o ausente no cuenta como cubierto ni como faltante. Los dos casos de
   control de arriba deben registrarse como decisión.
3. **Captura sin conteo.** La captura pide una cantidad (`stock`). Si en campo solo se
   quiere marcar "hay / no hay", se manda `1` o `0`; un campo aparte sería una decisión
   nueva.
