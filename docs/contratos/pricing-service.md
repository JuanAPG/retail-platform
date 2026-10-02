# Contrato: pricing-service (Fase A — revisado en equipo antes de clientes)

Base: `http://pricing-service:3103` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`pricing-service.xsd`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}` (siempre JSON). Listados
paginados según `paginacion.md`. Todas las rutas requieren
`Authorization: Bearer <accessToken>` y sesión activa en Redis (`SessionGuard`).

Rutas y campos en **inglés**, igual que `Contrato_Metodos_Endpoints` (Sprint 1), porque
Elasticidad (Leonardo) y Accesibilidad (Fernando) integran contra estos nombres.

## Qué es un precio

Un precio cuelga de **presentación + tienda** (RN-06), no de producto ni de zona: dos
presentaciones del mismo producto valen distinto, y la zona se deriva de la tienda. Este
servicio es dueño de la tabla `precios`; las presentaciones, tiendas y zonas son de
`catalog-service` y aquí solo se **leen**.

**El histórico no se sobrescribe**: registrar un precio nuevo para una presentación y
tienda **cierra** el vigente (le pone fecha de fin, un día antes de la nueva vigencia) y
abre el nuevo. De ese historial se calcula elasticidad y variación de precios.

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/prices` | Administrador, Responsable de precios |
| GET | `/v1/prices/history` | Los 6 perfiles internos |
| GET | `/v1/prices/compare-zones` | Los 6 perfiles internos |

El Proveedor no tiene acceso a estas tres rutas (`403`); solo propone precios por
`/v1/price-proposals` (más abajo).

### Objeto Price

```json
{
  "id": "uuid",
  "presentationId": "uuid",
  "storeId": "uuid",
  "price": "42.50",
  "effectiveDate": "2026-09-14",
  "effectiveUntil": null,
  "vigente": true,
  "origen": "interno",
  "createdBy": "uuid",
  "createdAt": "2026-09-14T15:00:00.000Z",
  "presentation": {
    "id": "uuid",
    "productoId": "uuid",
    "nombre": "1 kg",
    "contenido": "1.000",
    "unidadMedida": "kg"
  },
  "store": {
    "id": "uuid",
    "nombre": "Super Valle Centro",
    "zonaId": "uuid",
    "zona": { "id": "uuid", "nombre": "Zona Valle" }
  }
}
```

- `price` es **cadena decimal** (`numeric(12,2)`), para no perder precisión.
- `effectiveDate` / `effectiveUntil` son fechas `YYYY-MM-DD`. `effectiveUntil: null` =
  precio **vigente**; `vigente` lo calcula la base a partir de eso y nunca se escribe.
- `origen`: `interno` | `propuesta_proveedor_aprobada` (esta última, solo cuando exista el
  flujo de propuestas).
- `presentation` y `store` son un **resumen** (no el registro completo del catálogo): lo
  necesario para mostrar el precio sin otra llamada. El detalle completo se pide a
  `catalog-service`.

### POST /v1/prices

Registra un precio nuevo para una presentación en una tienda.

```json
{
  "presentationId": "uuid",
  "storeId": "uuid",
  "price": 42.5,
  "effectiveDate": "2026-09-14"
}
```

| Campo | Regla |
|---|---|
| `presentationId` | obligatorio, UUID de una presentación existente (si no → `400`) |
| `storeId` | obligatorio, UUID de una tienda existente (si no → `400`) |
| `price` | obligatorio, numérico mayor a 0 |
| `effectiveDate` | opcional, fecha ISO; por omisión, hoy |

Campos no listados (p. ej. `origen`, `createdBy`) → `400`: los fija el servidor
(`origen: "interno"`, `createdBy` sale del token).

Response `201`: objeto Price (el nuevo, ya vigente). Si ya había un precio vigente para
esa presentación y tienda, se cierra **en la misma transacción** con
`effectiveUntil = effectiveDate − 1 día`.

`409` si el precio vigente tiene una fecha igual o posterior a `effectiveDate` (no se
permite insertar precios hacia atrás: reescribiría el historial), o si otra petición
registró un precio al mismo tiempo.

### GET /v1/prices/history

Histórico de precios de un producto (todas sus presentaciones), o de una presentación.

| Query | Regla |
|---|---|
| `productId` | **obligatorio**, UUID de un producto existente |
| `presentationId` | opcional, UUID; restringe a una presentación de ese producto |
| `page`, `limit` | paginación estándar |

Orden fijo: `effectiveDate` **descendente** (lo más reciente primero), luego `createdAt`
descendente. Response `200`: `{ "data": [Price], "total": n, "page": 1, "limit": 20 }`.

`productId` ausente o no UUID → `400`; producto inexistente → `404`. Un producto sin
precios devuelve `data: []`.

### GET /v1/prices/compare-zones

Compara el precio **vigente** de un producto entre las zonas donde se vende. Es un
agregado para gráficas: **no se pagina** (excepción declarada en `paginacion.md`).

| Query | Regla |
|---|---|
| `productId` | **obligatorio**, UUID de un producto existente |

Response `200`:

```json
{
  "productId": "uuid",
  "zones": [
    {
      "zoneId": "uuid",
      "zoneName": "Zona Centro",
      "averagePrice": 41.25,
      "minPrice": 39.9,
      "maxPrice": 42.5,
      "storeCount": 2
    }
  ]
}
```

Los importes de este agregado son **números** (promedio calculado), a diferencia de
`price`. Orden: `zoneName` ascendente. Sin precios vigentes → `zones: []`.
`productId` ausente o no UUID → `400`; producto inexistente → `404`.

### Códigos de error

| Status | Cuándo |
|---|---|
| 400 | Cuerpo inválido, campo no permitido, `productId`/ids no UUID, presentación o tienda inexistente al registrar |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso sobre la ruta |
| 404 | Producto inexistente (history, compare-zones) |
| 409 | Fecha de vigencia no posterior al precio vigente; registro simultáneo |

### Auditoría

Cada `POST /v1/prices` **exitoso** se reporta a `audit-service` (`POST /v1/auditoria`, ver
`audit-service.md`) con `tabla: "precios"`, `accion: "insert"`, el `registroId` del precio nuevo,
el actor (`usuarioId`, `rolId`) y su IP. Los `cambios` llevan el precio que se cerró y el nuevo:

```json
[
  { "campo": "precio_anterior", "previo": "40.00", "posterior": null },
  { "campo": "precio", "previo": null, "posterior": "42.5" }
]
```

(`precio_anterior.previo` es `null` si era el primer precio de esa presentación y tienda.)
El historial de un precio se consulta con `GET /v1/auditoria?tabla=precios&registroId=<id>`.

- El reporte ocurre **después** de confirmar la transacción y **nunca rompe** el alta: si
  `audit-service` no responde, el precio se registra igual y solo se deja una advertencia en el log.
- Las peticiones rechazadas (400, 409) no generan evento. Las lecturas tampoco.
- Requiere `AUDIT_SERVICE_URL` (por omisión no reporta).

### Caché (Redis)

`GET /v1/prices/history` y `GET /v1/prices/compare-zones` se cachean en Redis (prefijo `pricing:`,
TTL 5 min). Todo lo cacheado de un producto cuelga de una **versión** (`pricing:v:<productId>`): cada
precio nuevo (alta directa o por aprobación de propuesta) sube la versión, así que **la respuesta nunca
es anterior a un precio ya registrado**. El TTL acota lo que la versión no ve: cambios de
`catalog-service` (renombrar una tienda o zona, mover una tienda de zona). Los errores (400, 404) no se
cachean. Si Redis no responde, el servicio contesta desde Postgres como si no hubiera caché.

## /v1/price-proposals — Propuestas de precio del Proveedor (RN-14)

Un Proveedor propone un precio para una presentación de **su** producto; alguien interno lo
**aprueba o rechaza**. Si se aprueba, el precio entra al histórico de `precios` con
`origen: "propuesta_proveedor_aprobada"` (mismo flujo que el alta de producto, RF-12).
Este servicio es dueño de `precios_propuestos_proveedor`.

> **Decisiones pendientes de confirmar con el equipo** (el texto de RN-14 no está en el repo; lo
> de abajo es la interpretación mínima y cada punto es fácil de cambiar):
> 1. **Quién aprueba:** Administrador y Gerente de categoría (como en productos; coincide con la
>    pestaña "Aprobaciones de precio" del portal de categoría). Es la constante `APRUEBAN_PRECIOS`.
> 2. **A qué tiendas aplica:** el esquema guarda la propuesta por presentación, sin tienda. Por eso
>    **quien aprueba elige las tiendas** (`storeIds`) y la fecha; nada se aplica en silencio.
> 3. **Qué precio es:** se trata como **precio de venta** de la presentación (entra a `precios`). Si
>    fuera costo de compra, no debería mezclarse con precios de anaquel. `purchaseUnit` solo se
>    guarda como dato informativo.
> 4. **Una propuesta pendiente por presentación y proveedor** (para no saturar la bandeja).

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/price-proposals` | Proveedor |
| GET | `/v1/price-proposals` | Proveedor (solo las suyas), Administrador, Gerente de categoría, Responsable de precios, Auditor |
| PATCH | `/v1/price-proposals/:id/approve` | Administrador, Gerente de categoría |
| PATCH | `/v1/price-proposals/:id/reject` | Administrador, Gerente de categoría |

### Objeto PriceProposal

```json
{
  "id": "uuid",
  "presentationId": "uuid",
  "supplierId": "uuid",
  "proposedPrice": "38.00",
  "purchaseUnit": "caja 12 pzas",
  "status": "pendiente",
  "rejectionReason": null,
  "reviewedBy": null,
  "reviewedAt": null,
  "createdAt": "2026-09-30T15:00:00.000Z",
  "presentation": {
    "id": "uuid",
    "productoId": "uuid",
    "nombre": "400 g",
    "contenido": "400.000",
    "unidadMedida": "g",
    "producto": { "sku": "LDN-QUE-400", "nombre": "Queso fresco 400 g" }
  },
  "supplier": { "id": "uuid", "razonSocial": "Lácteos del Norte S.A." }
}
```

- `status`: `pendiente` | `aprobado` | `rechazado`.
- `proposedPrice` es **cadena decimal** (`numeric(12,2)`).
- `rejectionReason` solo viene en las rechazadas: **el Proveedor sí puede ver por qué** se le rechazó.

### POST /v1/price-proposals (Proveedor)

```json
{ "presentationId": "uuid", "proposedPrice": 38, "purchaseUnit": "caja 12 pzas" }
```

| Campo | Regla |
|---|---|
| `presentationId` | obligatorio, UUID de una presentación existente (si no → `400`) |
| `proposedPrice` | obligatorio, numérico mayor a 0 |
| `purchaseUnit` | opcional, ≤ 30 caracteres |

El servidor fija lo que el proveedor no decide: `supplierId` sale de su cuenta (vínculo por correo,
`usuarios.email` = `proveedores.email`), `status` nace `pendiente`. Mandar `supplierId`, `status` u
otro campo no listado → `400`.

Response `201`: PriceProposal. Errores específicos:
`403` cuenta sin empresa vinculada, empresa inactiva, o la presentación **no es de un producto de su
empresa**; `409` el producto aún no está `activo`, o ya hay una propuesta `pendiente` suya para esa
presentación.

### GET /v1/price-proposals

Paginado (`page`, `limit`). Filtro opcional `status` (`pendiente` | `aprobado` | `rechazado`; otro
valor → `400`). Un Proveedor recibe **únicamente las de su empresa** (el recorte va en la consulta,
no en el cliente). Orden: más reciente primero; con `status=pendiente`, **la más antigua primero**
(es una cola de trabajo). Response `200`: `{ "data": [PriceProposal], "total": n, "page": 1, "limit": 20 }`.

### PATCH /v1/price-proposals/:id/approve

```json
{ "storeIds": ["uuid-tienda-1", "uuid-tienda-2"], "effectiveDate": "2026-10-05" }
```

| Campo | Regla |
|---|---|
| `storeIds` | obligatorio, de 1 a 50 UUID sin repetir, de tiendas existentes (si no → `400`) |
| `effectiveDate` | opcional, `YYYY-MM-DD`; por omisión, hoy |

Aplica `proposedPrice` a cada tienda como un precio nuevo (cierra el vigente de esa presentación y
tienda, igual que `POST /v1/prices`, con `origen: "propuesta_proveedor_aprobada"` y como autor a quien
aprueba) y marca la propuesta `aprobado` con revisor y fecha. **Todo en una sola transacción**: si
alguna tienda falla, no se aplica nada.

Response `200`: `{ "proposal": PriceProposal, "prices": [Price] }` (los precios creados, ver
`Price` arriba).

`409` si la propuesta ya fue resuelta (dos revisores no se sobrescriben), o si en alguna tienda el
precio vigente tiene fecha igual o posterior a `effectiveDate`.

### PATCH /v1/price-proposals/:id/reject

```json
{ "rejectionReason": "El precio propuesto excede el límite de variación de la zona." }
```

`rejectionReason`: obligatorio, mínimo 10 caracteres. Response `200`: PriceProposal `rechazado`, con
motivo, revisor y fecha. Ya resuelta → `409`.

### Otros efectos

- **Auditoría:** la propuesta (`tabla: "precios_propuestos_proveedor"`, `insert`), su resolución
  (`update` con el cambio de `estatus` y el motivo) y cada precio creado (`tabla: "precios"`, `insert`).
- **Caché:** aprobar invalida lo cacheado (historial y comparación) de ese producto.
- `404` si la propuesta no existe; `400` si `:id` no es UUID; `403` si el rol no puede resolver.

### Códigos de error de esta sección

| Status | Cuándo |
|---|---|
| 400 | Cuerpo inválido, campo no permitido, `:id`/ids no UUID, presentación o tienda inexistente, `status` inválido, motivo corto |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso; empresa inactiva o sin vincular; presentación de otra empresa |
| 404 | Propuesta inexistente |
| 409 | Propuesta duplicada pendiente; producto no activo; propuesta ya resuelta; fecha no posterior al vigente |

### Pendiente (no es parte de este contrato todavía)

- Notificación de cambios de precio y de propuestas (`notifications-service`).
