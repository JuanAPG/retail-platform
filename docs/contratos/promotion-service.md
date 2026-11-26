# Contrato: promotion-service (T-07 · Sprint 4)

Base: `http://promotion-service:3115` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`promotion-service.xsd`, namespace `promotion/v1`). Acepta cuerpos JSON o XML
(`Content-Type: application/xml`, raíz indicada en cada ruta, mismo `xmlns`; XML mal
formado, raíz distinta o con `DOCTYPE`/`ENTITY` → `400`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}` y los códigos de
`services/snippets/error-codes.md`. Listados paginados según `paginacion.md`.

Plantilla: `services/template-nest/` (con T-02: `X-Correlation-Id` y health con
dependencias). `GET /v1/health` sigue `health.xsd`.

Decisiones que aplica: **D-39** (tipos, quién propone y quién aprueba; no toca el histórico
ni la elasticidad), **D-46** (el aviso de aprobación pendiente no se puede apagar),
**D-06** (no se promedian presentaciones; precio normalizado por kg/L), **D-05** (precio
vigente por fecha), **D-07/D-08** (presentación inactiva o producto no activo no se
promueve), **D-26** (solo ids de usuario) y **D1** (por analogía: el Responsable de precios
es quien aprueba).

> **PROPUESTA** = lo propone Fernando, falta pasarlo a la Matriz. **PENDIENTE** = no se
> implementa hasta que se acuerde.

---

## 1. Rutas (todas nuevas)

| Método | Ruta | Qué hace | Raíz XML |
|---|---|---|---|
| POST | `/v1/promotions` | El Gerente propone una promoción (nace `pendiente`) | petición `promocionRequest` · respuesta `promocionResponse` |
| GET | `/v1/promotions` | Lista paginada con filtros | `promocionListResponse` |
| GET | `/v1/promotions/:id` | Una promoción | `promocionResponse` |
| PATCH | `/v1/promotions/:id/approve` | El Responsable de precios aprueba | `promocionResponse` |
| PATCH | `/v1/promotions/:id/reject` | El Responsable de precios rechaza con motivo | petición `rechazoPromocionRequest` · respuesta `promocionResponse` |
| GET | `/v1/promotions/:id/unit-price?storeId=` | Precio unitario regular vs. promocional en una tienda | `precioUnitarioResponse` |
| GET | `/v1/promotions/compare?ids=&storeId=` | Compara de 2 a 10 promociones del mismo producto por precio unitario | `comparacionPromocionesResponse` |
| GET | `/v1/health` | Estado del servicio (sin autenticación) | `response` (`health.xsd`) |

`compare` es ruta literal; en las demás, `:id` es UUID (otro valor → `400`).

## 2. Autenticación, permisos y correlación

### Autenticación

Todas las rutas, menos `GET /v1/health`, exigen `Authorization: Bearer <accessToken>`
**y** sesión activa en Redis (`SessionGuard`). Sin token, token expirado, manipulado o
sesión revocada → `401`. Quién propone y quién resuelve sale **del token**; el cuerpo no
acepta `proposedBy`, `resolvedBy` ni `status` (→ `400`).

### Fila de la Matriz §3.2

| Admin | Analista | Gerente | Resp. precios | Planeador | Auditor | Proveedor | Investigador |
|---|---|---|---|---|---|---|---|
| L | L | **P** (+ L) | **A** (+ L) | L | L | – | – |

Gerente = Propone y Responsable de precios = Aprueba los fija **D-39**. Los otros seis
perfiles son **PROPUESTA**: los internos leen (el Planeador las necesita para simular
descuentos, RF-47; el Auditor para validar); Proveedor e Investigador no tienen acceso
(D-28: el Investigador no tiene nada fuera de su lista).

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/promotions` | `Gerente de categoría` |
| PATCH | `/v1/promotions/:id/approve` · `/reject` | `Responsable de precios` |
| GET | `/v1/promotions`, `/:id`, `/:id/unit-price`, `/compare` | Los 6 perfiles internos |

- El `Gerente de categoría` que intenta aprobar o rechazar → `403` (D-39). Ningún otro rol
  aprueba: ni el Administrador.
- El `Responsable de precios` que intenta proponer → `403`.
- `Proveedor` e `Investigador de mercado` → `403` en todas.
- Un pendiente es visible para los 6 perfiles internos (no aplica D-08: es un documento
  interno, no un producto del catálogo). **PROPUESTA.**

### Correlación (`X-Correlation-Id`, T-02)

- Se acepta si cumple `^[A-Za-z0-9._:-]{1,100}$`; si falta o no cumple, se genera un UUID.
  Se devuelve siempre en el encabezado de la respuesta (también en errores).
- Va en cada línea de log; en cada llamada a catalog-service, pricing-service,
  audit-service y notifications-service (junto con el `Authorization` del usuario); en la
  columna `correlation_id` de `promociones` y de `promocion_eventos`.

## 3. Unidades, ids y zona horaria

| Dato | Formato |
|---|---|
| `id`, `productId`, `presentationId`, `storeId`, `zoneId`, `proposedBy`, `resolvedBy` | UUID (usuarios: solo el id, D-26) |
| `validFrom`, `validTo`, `effectiveDate` | `YYYY-MM-DD`, **día local de America/Monterrey** (UTC−06:00), los dos **inclusivos**. Variable `BUSINESS_TIMEZONE` (default `America/Monterrey`) |
| `proposedAt`, `resolvedAt` | Instante ISO 8601 en **UTC** (`…Z`) |
| Importes (`packPrice`, `promoPrice`, `price`, `purchasePrice`, `unitPrice`) | **MXN**, número > 0, 2 decimales (mismo criterio de impuestos que pricing-service). Los calculados se redondean a 2 decimales **solo al final** (mitad hacia arriba) |
| `discountPct`, `savingsPct` | Porcentaje (`10` = 10 %), 2 decimales |
| `promoContent` | Número > 0, hasta 3 decimales, en la unidad `promoUnit` |
| `promoUnit` | Clave de `unidades_medida` (catalog `GET /v1/units`: `kg`, `g`, `l`, `ml`, `pza`…) |
| `contentBase` | Contenido convertido a la **unidad base** de su tipo: `contenido × factor_base` |
| `baseUnit` | `kg` (masa), `l` (volumen) o `pza` (pieza), igual que `perUnit` de pricing-service. El tipo `longitud` no tiene precio unitario comparable → `400` |

## 4. Tipos de promoción (D-39)

| `type` | Campos obligatorios | Prohibidos | Precio de compra | Unidades compradas | Contenido base |
|---|---|---|---|---|---|
| `descuento_porcentual` | `discountPct` (0 < x < 100) | `pack*`, `promo*` | `precio regular × (1 − discountPct/100)` | 1 | `contenido × factor` de la presentación |
| `paquete` ("n por $") | `packQuantity` (entero 2–99), `packPrice` | `discountPct`, `promo*` | `packPrice` | `packQuantity` | `packQuantity × contenido × factor` |
| `tamano_empaque` | `promoContent`, `promoUnit`, `promoPrice` | `discountPct`, `pack*` | `promoPrice` | 1 | `promoContent × factor(promoUnit)` |

**Precio unitario** = precio de compra / contenido base (MXN por `baseUnit`).

**Unidades incompatibles → `400`.** En `tamano_empaque`, `promoUnit` debe ser del **mismo
tipo** que la unidad de la presentación (masa con masa, volumen con volumen). `ml` sobre
una presentación en `kg` → `400 VALIDATION_ERROR` ("unidades incompatibles: ml (volumen)
no se compara con kg (masa)"). Lo mismo en `compare` si las presentaciones no comparten
tipo de unidad.

**No toca el histórico de precios ni la elasticidad (D-39).** La promoción vive en sus
propias tablas. Aprobarla **no** anexa nada a `precios`, no cierra el precio vigente y no
entra a las corridas de elasticidad; el precio regular se **lee** de pricing-service por
HTTP, nunca se escribe.

### Caso de control (prueba unitaria; registrarlo como decisión)

Arroz, presentación **1 kg** (`kg`, factor 1), precio regular vigente en la tienda X:
**$30.00**.

| Promoción | Precio de compra | Unidades | Contenido base | Precio unitario | Ahorro vs. regular |
|---|---|---|---|---|---|
| Descuento 10 % | 27.00 | 1 | 1.000 kg | **27.00 MXN/kg** | **10.00 %** |
| Paquete 3 por $80 | 80.00 | 3 | 3.000 kg | **26.67 MXN/kg** (80/3) | **11.11 %** |
| Tamaño de empaque 1,200 g por $30 | 30.00 | 1 | 1.200 kg | **25.00 MXN/kg** | **16.67 %** |
| Tamaño de empaque 1,200 **ml** | — | — | — | `400`, unidades incompatibles | — |

`savingsPct = (unitario regular − unitario promocional) / unitario regular × 100`. Orden de
`compare`: tamaño (25.00) → paquete (26.67) → descuento (27.00).

## 5. Flujo y fechas límite

```
Gerente propone ──► PENDIENTE ──► Resp. de precios aprueba ──► APROBADA (programada → vigente → vencida, por fecha)
                        └───────► Resp. de precios rechaza (motivo) ──► RECHAZADA (final)
```

- `validity` se calcula por fecha (día local de Monterrey) para `pendiente` y `aprobada`:
  `programada` (hoy < `validFrom`), `vigente` (`validFrom` ≤ hoy ≤ `validTo`), `vencida`
  (hoy > `validTo`). En `rechazada` no sale.
- **Al proponer:** `validFrom` ≥ hoy (no hay promociones retroactivas) y
  `validTo` ≥ `validFrom`; si no → `400`.
- **Al aprobar:** si hoy > `validTo` (la promoción ya venció) → `409`. Si `validFrom` ya pasó
  pero `validTo` no, se aprueba y queda `vigente` desde ese momento.
- **Doble resolución:** aprobar o rechazar una que ya no está `pendiente` → `409`. La
  transición es atómica (`UPDATE … WHERE id = $1 AND estatus = 'pendiente'`): si dos
  llegan a la vez, una pasa y la otra recibe `409`.
- Rechazar una pendiente vencida sí se permite (limpia la bandeja).
- No hay edición: para cambiar algo, el Gerente propone otra (igual que D-11 para el
  Proveedor). **PROPUESTA.**
- **PENDIENTE:** qué pasa si dos promociones aprobadas de la misma presentación se enciman
  en tienda o zona y fechas (¿se rechaza, se permite, se combinan?). Mientras no se decida,
  no se bloquea ni se combina: `unit-price` calcula cada promoción por separado.

## 6. POST /v1/promotions (Gerente de categoría)

Ámbito: **exactamente uno** de `storeId` o `zoneId` (**PROPUESTA**; con zona aplica a las
tiendas activas de la zona). Ninguno o los dos → `400`.

Se valida por HTTP con catalog-service (reenviando `Authorization` y `X-Correlation-Id`,
timeout 3 s): `GET /v1/products/:productId/presentations` (la presentación es de ese
producto, está activa y trae su unidad y factor), `GET /v1/products/:productId` (producto
`activo`), `GET /v1/stores/:storeId` o `GET /v1/zones/:zoneId` y `GET /v1/units` (factor de
`promoUnit`). Inexistente → `400`; presentación inactiva o producto no `activo` → `409`
(D-07, D-08); catalog sin responder → `503`.

Válido (JSON):

```json
{
  "name": "Arroz 1 kg con 10 % en Zona Centro",
  "type": "descuento_porcentual",
  "productId": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  "presentationId": "8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e",
  "zoneId": "f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44",
  "discountPct": 10,
  "validFrom": "2026-11-01",
  "validTo": "2026-11-15"
}
```

El mismo en XML (`Content-Type: application/xml`; el orden de los elementos es el del XSD):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<promocionRequest xmlns="promotion/v1">
  <name>Arroz 1 kg con 10 % en Zona Centro</name>
  <type>descuento_porcentual</type>
  <productId>1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f</productId>
  <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
  <zoneId>f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44</zoneId>
  <discountPct>10</discountPct>
  <validFrom>2026-11-01</validFrom>
  <validTo>2026-11-15</validTo>
</promocionRequest>
```

Otro tipo, un paquete en una tienda:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<promocionRequest xmlns="promotion/v1">
  <name>Arroz 1 kg: 3 por $80</name>
  <type>paquete</type>
  <productId>1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f</productId>
  <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
  <storeId>27f05c81-c6bf-456a-a273-150e4edb9900</storeId>
  <packQuantity>3</packQuantity>
  <packPrice>80.00</packPrice>
  <validFrom>2026-11-01</validFrom>
  <validTo>2026-11-15</validTo>
</promocionRequest>
```

| Campo | Regla |
|---|---|
| `name` | obligatorio, 3 a 120 caracteres |
| `type` | obligatorio: `descuento_porcentual` \| `paquete` \| `tamano_empaque` |
| `productId`, `presentationId` | obligatorios, UUID; la presentación debe ser de ese producto |
| `storeId` / `zoneId` | exactamente uno |
| Campos del tipo | según la tabla de §4: los obligatorios presentes y los prohibidos ausentes |
| `validFrom`, `validTo` | obligatorios, `YYYY-MM-DD`; `validFrom` ≥ hoy, `validTo` ≥ `validFrom` |
| Campos no listados | `400` |

Response `201` (`promocionResponse`):

```json
{
  "id": "3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7",
  "name": "Arroz 1 kg con 10 % en Zona Centro",
  "type": "descuento_porcentual",
  "productId": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  "presentationId": "8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e",
  "storeId": null,
  "zoneId": "f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44",
  "discountPct": 10,
  "packQuantity": null, "packPrice": null,
  "promoContent": null, "promoUnit": null, "promoPrice": null,
  "currency": "MXN",
  "validFrom": "2026-11-01",
  "validTo": "2026-11-15",
  "status": "pendiente",
  "validity": "programada",
  "proposedBy": "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d",
  "proposedAt": "2026-10-29T17:20:00.000Z",
  "resolvedBy": null, "resolvedAt": null, "rejectionReason": null
}
```

Rechazo — `tamano_empaque` con unidad de otro tipo (`400`):

```json
{
  "statusCode": 400,
  "message": "Unidades incompatibles.",
  "code": "VALIDATION_ERROR",
  "details": ["promoUnit: ml (volumen) no se compara con la presentación en kg (masa)"],
  "path": "/v1/promotions",
  "timestamp": "2026-10-29T17:20:00.000Z"
}
```

Otros rechazos: `validFrom` en el pasado o `validTo < validFrom` → `400`; `discountPct: 100`
→ `400`; con `discountPct` y `packPrice` a la vez → `400`; el Responsable de precios
propone → `403`.

## 7. GET /v1/promotions

Paginado, el más reciente (`proposedAt`) primero; con `status=pendiente` es una cola: el
más antiguo primero. Query opcional: `status`, `type`, `productId`, `presentationId`,
`storeId`, `zoneId`, `activeOn=YYYY-MM-DD` (aprobadas vigentes ese día).

Válido (`200`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<promocionListResponse xmlns="promotion/v1">
  <data>
    <item>
      <id>3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7</id>
      <name>Arroz 1 kg con 10 % en Zona Centro</name>
      <type>descuento_porcentual</type>
      <productId>1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f</productId>
      <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
      <zoneId>f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44</zoneId>
      <discountPct>10</discountPct>
      <currency>MXN</currency>
      <validFrom>2026-11-01</validFrom>
      <validTo>2026-11-15</validTo>
      <status>pendiente</status>
      <validity>programada</validity>
      <proposedBy>2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d</proposedBy>
      <proposedAt>2026-10-29T17:20:00.000Z</proposedAt>
    </item>
  </data>
  <total>1</total>
  <page>1</page>
  <limit>20</limit>
</promocionListResponse>
```

Rechazo: `status=vigente` (no es un estado; para eso está `activeOn`) o `zoneId=abc` →
`400` con `details`; un Proveedor → `403`.

## 8. GET /v1/promotions/:id

Válido: `200` con `promocionResponse` (la forma de §6). Rechazo: inexistente → `404`
`NOT_FOUND`; `:id` no UUID → `400`; Investigador de mercado → `403`.

## 9. PATCH /v1/promotions/:id/approve (Responsable de precios)

Sin cuerpo. Pasa de `pendiente` a `aprobada`, guarda `resolvedBy` (del token) y
`resolvedAt`. **No anexa nada a `precios`** (D-39).

Válido (`200`, `promocionResponse`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<promocionResponse xmlns="promotion/v1">
  <id>3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7</id>
  <name>Arroz 1 kg con 10 % en Zona Centro</name>
  <type>descuento_porcentual</type>
  <productId>1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f</productId>
  <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
  <zoneId>f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44</zoneId>
  <discountPct>10</discountPct>
  <currency>MXN</currency>
  <validFrom>2026-11-01</validFrom>
  <validTo>2026-11-15</validTo>
  <status>aprobada</status>
  <validity>programada</validity>
  <proposedBy>2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d</proposedBy>
  <proposedAt>2026-10-29T17:20:00.000Z</proposedAt>
  <resolvedBy>3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e</resolvedBy>
  <resolvedAt>2026-10-30T16:05:00.000Z</resolvedAt>
</promocionResponse>
```

Rechazo — doble aprobación (`409`), en XML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<error xmlns="promotion/v1">
  <statusCode>409</statusCode>
  <message>La promoción ya está aprobada; no se resuelve dos veces.</message>
  <code>CONFLICT</code>
  <path>/v1/promotions/3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7/approve</path>
  <timestamp>2026-10-30T16:06:00.000Z</timestamp>
</error>
```

Rechazo — rol incorrecto: el Gerente de categoría intenta aprobar (`403`, D-39):

```json
{ "statusCode": 403, "message": "Solo el Responsable de precios aprueba promociones.", "code": "FORBIDDEN",
  "details": null, "path": "/v1/promotions/3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7/approve",
  "timestamp": "2026-10-30T16:06:00.000Z" }
```

Rechazo — fecha límite: aprobar el 16-nov una que vencía el 15-nov (`409`):

```json
{ "statusCode": 409, "message": "La vigencia de la promoción terminó el 2026-11-15; ya no se puede aprobar.",
  "code": "CONFLICT", "details": null, "path": "/v1/promotions/3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7/approve",
  "timestamp": "2026-11-16T15:00:00.000Z" }
```

Inexistente → `404`.

## 10. PATCH /v1/promotions/:id/reject (Responsable de precios)

Cuerpo obligatorio: `reason` de 10 a 500 caracteres. Pasa a `rechazada` (final).

```json
{ "reason": "El descuento se encima con la campaña de regreso a clases." }
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rechazoPromocionRequest xmlns="promotion/v1">
  <reason>El descuento se encima con la campaña de regreso a clases.</reason>
</rechazoPromocionRequest>
```

Válido: `200` con `promocionResponse`, `status: "rechazada"`, `rejectionReason` lleno y sin
`validity`. Rechazo: `reason` con menos de 10 caracteres → `400`; ya resuelta → `409`;
Gerente → `403`.

```json
{ "statusCode": 400, "message": "Datos inválidos.", "code": "VALIDATION_ERROR",
  "details": ["reason debe tener entre 10 y 500 caracteres"],
  "path": "/v1/promotions/3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7/reject", "timestamp": "2026-10-30T16:06:00.000Z" }
```

## 11. GET /v1/promotions/:id/unit-price?storeId=

Calcula el precio unitario regular y el promocional en **una tienda**. Sirve para revisar
una promoción `pendiente` antes de aprobarla. Sin efectos: no guarda nada.

- `storeId` obligatorio si la promoción es por zona (y debe ser una tienda activa de esa
  zona); opcional si es por tienda (por omisión, la suya). Fuera del ámbito → `400`.
- El precio regular es el **vigente hoy** (D-05) de esa presentación en esa tienda:
  `GET {PRICING_SERVICE_URL}/v1/prices/current?presentationId=&storeId=` (timeout 3 s → `503`).
- Sin precio regular: en `descuento_porcentual` no se puede calcular nada →
  `disponible: false` con `motivo`, **sin `promotional` ni `savingsPct`** (nunca 0). En
  `paquete` y `tamano_empaque` el promocional sí se calcula; `regular.disponible: false` y
  sin `savingsPct`.

Válido — el paquete 3 por $80 del caso de control (`200`):

```json
{
  "promotionId": "4f6a8b02-3c5d-4e7f-9a21-b3c4d5e6f708",
  "type": "paquete",
  "status": "aprobada",
  "productId": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  "presentationId": "8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e",
  "storeId": "27f05c81-c6bf-456a-a273-150e4edb9900",
  "baseUnit": "kg",
  "currency": "MXN",
  "disponible": true,
  "motivo": null,
  "regular": { "disponible": true, "price": 30.00, "effectiveDate": "2026-10-01", "contentBase": 1.000, "unitPrice": 30.00, "motivo": null },
  "promotional": { "purchasePrice": 80.00, "items": 3, "contentBase": 3.000, "unitPrice": 26.67 },
  "savingsPct": 11.11
}
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<precioUnitarioResponse xmlns="promotion/v1">
  <promotionId>4f6a8b02-3c5d-4e7f-9a21-b3c4d5e6f708</promotionId>
  <type>paquete</type>
  <status>aprobada</status>
  <productId>1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f</productId>
  <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
  <storeId>27f05c81-c6bf-456a-a273-150e4edb9900</storeId>
  <baseUnit>kg</baseUnit>
  <currency>MXN</currency>
  <disponible>true</disponible>
  <regular>
    <disponible>true</disponible>
    <price>30.00</price>
    <effectiveDate>2026-10-01</effectiveDate>
    <contentBase>1.000</contentBase>
    <unitPrice>30.00</unitPrice>
  </regular>
  <promotional>
    <purchasePrice>80.00</purchasePrice>
    <items>3</items>
    <contentBase>3.000</contentBase>
    <unitPrice>26.67</unitPrice>
  </promotional>
  <savingsPct>11.11</savingsPct>
</precioUnitarioResponse>
```

Descuento sin precio regular en la tienda (`200`, no disponible):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<precioUnitarioResponse xmlns="promotion/v1">
  <promotionId>3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7</promotionId>
  <type>descuento_porcentual</type>
  <status>pendiente</status>
  <productId>1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f</productId>
  <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
  <storeId>27f05c81-c6bf-456a-a273-150e4edb9900</storeId>
  <baseUnit>kg</baseUnit>
  <currency>MXN</currency>
  <disponible>false</disponible>
  <motivo>La presentación no tiene precio vigente en esta tienda; un descuento sin precio regular no se puede calcular.</motivo>
  <regular>
    <disponible>false</disponible>
    <motivo>Sin precio vigente en pricing-service.</motivo>
  </regular>
</precioUnitarioResponse>
```

Rechazo: promoción por zona sin `storeId`, o tienda de otra zona → `400`:

```json
{ "statusCode": 400, "message": "storeId es obligatorio para una promoción por zona.", "code": "VALIDATION_ERROR",
  "details": null, "path": "/v1/promotions/3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7/unit-price",
  "timestamp": "2026-10-30T16:10:00.000Z" }
```

Inexistente → `404`; pricing o catalog sin responder → `503`.

## 12. GET /v1/promotions/compare?ids=a,b,c&storeId=

Compara de **2 a 10** promociones del **mismo producto** en una tienda, ordenadas por
precio unitario ascendente (las no disponibles al final, con `motivo`). Permite comparar
presentaciones distintas **solo normalizadas** a la unidad base (D-06): nunca promedia.
No se pagina (tope propio de 10; excepción de `paginacion.md`). `storeId` obligatorio.

| Rechazo | Status |
|---|---|
| Menos de 2 o más de 10 ids, id repetido o no UUID, falta `storeId` | `400` |
| Promociones de productos distintos (**PROPUESTA**, igual que D-14) | `400` |
| Presentaciones con tipos de unidad distintos (`kg` vs `l`): **unidades incompatibles** | `400` |
| Alguna promoción no existe | `404` |

Válido — las tres del caso de control (`200`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<comparacionPromocionesResponse xmlns="promotion/v1">
  <productId>1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f</productId>
  <storeId>27f05c81-c6bf-456a-a273-150e4edb9900</storeId>
  <baseUnit>kg</baseUnit>
  <currency>MXN</currency>
  <data>
    <item>
      <promotionId>5a7b9c13-4d6e-4f80-8b32-c4d5e6f70819</promotionId>
      <type>tamano_empaque</type>
      <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
      <status>aprobada</status>
      <disponible>true</disponible>
      <unitPrice>25.00</unitPrice>
      <regularUnitPrice>30.00</regularUnitPrice>
      <savingsPct>16.67</savingsPct>
    </item>
    <item>
      <promotionId>4f6a8b02-3c5d-4e7f-9a21-b3c4d5e6f708</promotionId>
      <type>paquete</type>
      <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
      <status>aprobada</status>
      <disponible>true</disponible>
      <unitPrice>26.67</unitPrice>
      <regularUnitPrice>30.00</regularUnitPrice>
      <savingsPct>11.11</savingsPct>
    </item>
    <item>
      <promotionId>3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7</promotionId>
      <type>descuento_porcentual</type>
      <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
      <status>aprobada</status>
      <disponible>true</disponible>
      <unitPrice>27.00</unitPrice>
      <regularUnitPrice>30.00</regularUnitPrice>
      <savingsPct>10.00</savingsPct>
    </item>
  </data>
</comparacionPromocionesResponse>
```

Rechazo — unidades incompatibles (`400`):

```json
{ "statusCode": 400, "message": "Unidades incompatibles.", "code": "VALIDATION_ERROR",
  "details": ["Las presentaciones mezclan kg (masa) y l (volumen); no se comparan."],
  "path": "/v1/promotions/compare", "timestamp": "2026-10-30T16:10:00.000Z" }
```

## 13. Persistencia

PostgreSQL, tablas **nuevas** de este servicio (las agrega su responsable a `db/schema.sql`
con comentario de dueño; T-03/T-15). No usa MongoDB. Redis solo para la sesión.

| Tabla | Contenido |
|---|---|
| `promociones` | Una fila por promoción: tipo, producto, presentación, tienda o zona, campos del tipo, vigencia, estado, quién propuso y resolvió, motivo, `correlation_id`. Sin llaves foráneas a tablas de otros dueños: los ids se validan por HTTP |
| `promocion_eventos` | Bitácora propia, solo se anexa: `propuesta`, `aprobada`, `rechazada`, con actor, instante, `correlation_id`, `auditoria_estado` y `aviso_estado` (`enviado` \| `fallido` \| `no_aplica`) |

**No escribe** `precios`, `elasticidades` ni `analisis_corridas` (D-39).

## 14. Auditoría y avisos (no bloqueantes)

Después de guardar, sin esperar su resultado para responder, timeout **1.5 s**, con el
`Authorization` del usuario y el `X-Correlation-Id`. Si fallan, la operación **igual se
completa** y queda evidencia: línea `WARN aviso_fallido` (correlación, destino, evento, id
de la promoción, motivo) y `auditoria_estado` / `aviso_estado = fallido` en
`promocion_eventos`.

| Operación | Auditoría (`POST /v1/auditoria`) | Aviso (`POST /v1/notifications`) |
|---|---|---|
| Proponer | `tabla: "promociones"`, `accion: "insert"`, `registroId: id` | **`promocion.propuesta`**: origen Gerente de categoría → rol **Responsable de precios** (fijo). Es un aviso de **aprobación pendiente: no se puede apagar (D-46)** |
| Aprobar | `accion: "aprobar"`, `cambios: [{campo: "estatus", previo: "pendiente", posterior: "aprobada"}]` | **`promocion.resuelta`**: origen Responsable de precios → el usuario que propuso (`recipientUserId`); copia al rol Auditor (**PROPUESTA**, mismo patrón que `propuesta.resuelta`) |
| Rechazar | `accion: "rechazar"`, mismo `cambios` con `posterior: "rechazada"` y el motivo en `descripcion` | `promocion.resuelta`, con el motivo |

Si la operación falla (`400`, `403`, `404`, `409`), no se audita ni se avisa.

**Dependencia con Juan Ángel (bloqueante):** agregar `promotion-service` a la lista de
`servicio` de audit-service y a `sourceService` de notifications-service; agregar los
eventos `promocion.propuesta` y `promocion.resuelta` y marcar `promocion.propuesta` como
"aprobación pendiente" para que las preferencias de T-20 no lo dejen apagar (D-46).

## 15. Códigos de error

| Status | Cuándo |
|---|---|
| `400` | Cuerpo o query inválidos; campo no permitido; ids no UUID; campos que no corresponden al tipo; **unidades incompatibles**; `validFrom` pasado o `validTo < validFrom`; ámbito con ninguno o los dos; producto, presentación, tienda o zona inexistente; `storeId` fuera del ámbito; `compare` con productos distintos |
| `401` | Sin token, token revocado o sin sesión en Redis |
| `403` | Rol sin permiso: Gerente aprueba o rechaza, Responsable de precios propone, Proveedor o Investigador en cualquier ruta |
| `404` | Promoción inexistente |
| `409` | Ya resuelta (doble aprobación o rechazo); aprobar una vencida; presentación inactiva o producto no `activo` al proponer |
| `503` | catalog-service o pricing-service no responden en 3 s; PostgreSQL caído (D-25); Redis sin responder al validar la sesión |

## 16. GET /v1/health

Sin autenticación; siempre `200` si el proceso responde. Usa PostgreSQL y Redis; MongoDB
sale `"no configurado"`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<response>
  <status>ok</status>
  <service>promotion-service</service>
  <version>1.0.0</version>
  <checks>
    <postgres>ok</postgres>
    <mongodb>no configurado</mongodb>
    <redis>ok</redis>
  </checks>
  <latencyMs><postgres>3</postgres><mongodb>0</mongodb><redis>1</redis></latencyMs>
  <durationMs>5</durationMs>
  <timestamp>2026-10-30T15:00:00.000Z</timestamp>
</response>
```

Degradado (Postgres caído): `status: "degraded"`, `checks.postgres: "error: …"`; las rutas
de negocio responden `503`.
