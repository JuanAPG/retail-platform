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

> Fuera de este contrato por ahora: propuestas de precio del Proveedor
> (`precios_propuestos_proveedor`), que se definirán aparte.

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/prices` | Administrador, Responsable de precios |
| GET | `/v1/prices/history` | Los 6 perfiles internos |
| GET | `/v1/prices/compare-zones` | Los 6 perfiles internos |

El Proveedor no tiene acceso a ninguna ruta de precios (`403`).

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

### Pendiente (no es parte de este contrato todavía)

- Propuestas de precio del Proveedor y su aprobación.
- Reporte de cambios a auditoría (insert) — se define al coordinar con `audit-service`.
- Notificación de cambios de precio (`notifications-service`).
