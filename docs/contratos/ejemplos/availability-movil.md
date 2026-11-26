# Ejemplos reales: availability-service para la app móvil y offline-sync (Fernando)

Respuestas **capturadas del servicio corriendo** (rama `main` + seed local, 25-nov-2026), no escritas a mano.
Contrato completo: [`../availability-service.md`](../availability-service.md). Los ids son del seed local.

Todas las llamadas llevan `Authorization: Bearer <token>` (sesión activa en Redis) y conviene mandar
`X-Correlation-Id` para que la operación se siga en logs y bitácora. La captura la da de alta el
**Investigador de mercado** (o el Analista comercial); el Investigador **no lee** cobertura (`403`).

## POST /v1/availability/captures

### 1. Captura nueva → `201`, `status: aceptada`

Acuse en offline-sync: **aceptada**.

```json
POST /v1/availability/captures
{
  "captureId": "a0682e3c-cd60-4713-8473-e62736ece5ae",
  "storeId": "8917e994-8cee-4260-969b-bcdd9ae8911e",
  "presentationId": "1a667d0d-5c25-4215-825b-b11fcb5b4db9",
  "origin": "movil",
  "stock": 12,
  "capturedAt": "2026-11-25T23:45:21.903Z"
}
```

Respuesta `201`:

```json
{
  "captureId": "a0682e3c-cd60-4713-8473-e62736ece5ae",
  "status": "aceptada",
  "storeId": "8917e994-8cee-4260-969b-bcdd9ae8911e",
  "presentationId": "1a667d0d-5c25-4215-825b-b11fcb5b4db9",
  "stock": 12,
  "capturedAt": "2026-11-25T23:45:21.903Z",
  "receivedAt": "2026-11-25T23:46:22.190Z",
  "origin": "movil",
  "capturedBy": "d1ccce5f-cc31-4670-9d8a-1e405dc91cb0",
  "currentStock": 12,
  "currentCapturedAt": "2026-11-25T23:45:21.903Z",
  "reason": null
}
```

### 2. Reenvío del mismo `captureId` → `200`, `status: duplicada`

Devuelve el resultado original; no crea nada. Acuse: **duplicada**.

```json
POST /v1/availability/captures
{
  "captureId": "a0682e3c-cd60-4713-8473-e62736ece5ae",
  "storeId": "8917e994-8cee-4260-969b-bcdd9ae8911e",
  "presentationId": "1a667d0d-5c25-4215-825b-b11fcb5b4db9",
  "origin": "movil",
  "stock": 12,
  "capturedAt": "2026-11-25T23:45:21.903Z"
}
```

Respuesta `200`:

```json
{
  "captureId": "a0682e3c-cd60-4713-8473-e62736ece5ae",
  "status": "duplicada",
  "storeId": "8917e994-8cee-4260-969b-bcdd9ae8911e",
  "presentationId": "1a667d0d-5c25-4215-825b-b11fcb5b4db9",
  "stock": 12,
  "capturedAt": "2026-11-25T23:45:21.903Z",
  "receivedAt": "2026-11-25T23:46:22.190Z",
  "origin": "movil",
  "capturedBy": "d1ccce5f-cc31-4670-9d8a-1e405dc91cb0",
  "currentStock": 12,
  "currentCapturedAt": "2026-11-25T23:45:21.903Z",
  "reason": "Captura ya recibida (aceptada); no se registró de nuevo (D-42)."
}
```

### 3. Captura más vieja que el dato del servidor → `201`, `status: conflicto`

Se guarda en la bitácora pero **no sobrescribe** (gana la capturada después, D-42). `currentStock`/`currentCapturedAt` dicen qué quedó. Acuse: **conflicto**.

```json
POST /v1/availability/captures
{
  "captureId": "6887fd8c-3e0d-41ff-b251-9317ebb6cd13",
  "storeId": "8917e994-8cee-4260-969b-bcdd9ae8911e",
  "presentationId": "1a667d0d-5c25-4215-825b-b11fcb5b4db9",
  "origin": "movil",
  "stock": 3,
  "capturedAt": "2026-11-22T23:46:21.904Z"
}
```

Respuesta `201`:

```json
{
  "captureId": "6887fd8c-3e0d-41ff-b251-9317ebb6cd13",
  "status": "conflicto",
  "storeId": "8917e994-8cee-4260-969b-bcdd9ae8911e",
  "presentationId": "1a667d0d-5c25-4215-825b-b11fcb5b4db9",
  "stock": 3,
  "capturedAt": "2026-11-22T23:46:21.904Z",
  "receivedAt": "2026-11-25T23:46:22.322Z",
  "origin": "movil",
  "capturedBy": "d1ccce5f-cc31-4670-9d8a-1e405dc91cb0",
  "currentStock": 12,
  "currentCapturedAt": "2026-11-25T23:45:21.903Z",
  "reason": "El servidor ya tiene un dato capturado después (2026-11-25T23:45:21.903Z): esta captura no lo sobrescribe (D-42)."
}
```

### 4. Mismo `captureId` desde otro usuario → `409`

No revela la captura ajena. El dispositivo debe generar otro id. Acuse: **conflicto**.

```json
POST /v1/availability/captures
{
  "captureId": "a0682e3c-cd60-4713-8473-e62736ece5ae",
  "storeId": "8917e994-8cee-4260-969b-bcdd9ae8911e",
  "presentationId": "1a667d0d-5c25-4215-825b-b11fcb5b4db9",
  "origin": "movil",
  "stock": 5
}
```

Respuesta `409`:

```json
{
  "statusCode": 409,
  "message": "Ese captureId ya fue usado por otra captura.",
  "code": "CONFLICT",
  "details": null,
  "path": "/v1/availability/captures",
  "timestamp": "2026-11-25T23:46:22.351Z"
}
```

### 5. Cuerpo inválido (`stock` negativo) → `400`

Acuse: **rechazada** (no reintentar sin corregir).

```json
POST /v1/availability/captures
{
  "storeId": "8917e994-8cee-4260-969b-bcdd9ae8911e",
  "presentationId": "1a667d0d-5c25-4215-825b-b11fcb5b4db9",
  "origin": "movil",
  "stock": -1
}
```

Respuesta `400`:

```json
{
  "statusCode": 400,
  "message": "La petición no pasó la validación.",
  "code": "VALIDATION_ERROR",
  "details": [
    "stock no puede ser negativo."
  ],
  "path": "/v1/availability/captures",
  "timestamp": "2026-11-25T23:46:22.365Z"
}
```

### 6. Lo mismo en XML (`Accept: application/xml`, valida contra `availability-service.xsd`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<captureResponse xmlns="availability/v1">
  <captureId>66248299-b768-4934-b36e-7209f071c165</captureId>
  <status>conflicto</status>
  <storeId>8917e994-8cee-4260-969b-bcdd9ae8911e</storeId>
  <presentationId>1a667d0d-5c25-4215-825b-b11fcb5b4db9</presentationId>
  <stock>8</stock>
  <capturedAt>2026-11-25T23:45:21.903Z</capturedAt>
  <receivedAt>2026-11-25T23:46:22.381Z</receivedAt>
  <origin>movil</origin>
  <capturedBy>d1ccce5f-cc31-4670-9d8a-1e405dc91cb0</capturedBy>
  <currentStock>12</currentStock>
  <currentCapturedAt>2026-11-25T23:45:21.903Z</currentCapturedAt>
  <reason>El servidor ya tiene un dato capturado después (2026-11-25T23:45:21.903Z): esta captura no lo sobrescribe (D-42).</reason>
</captureResponse>
```

## GET /v1/availability/zones/:zoneId/coverage

Con un perfil interno (aquí, Analista comercial) → `200`:

```json
{
  "zoneId": "ae673d60-571e-4993-bf85-4e9f21c11e24",
  "validDays": 7,
  "stores": 1,
  "basics": 2,
  "covered": 0,
  "disponible": false,
  "coverage": null,
  "motivo": "Ninguna tienda de la zona tiene datos vigentes (7 días) de productos de la canasta básica (D-38).",
  "items": [
    {
      "productId": "c80752ec-84b1-44d2-b1b9-687740fb1fea",
      "productName": "Frijol negro",
      "status": "vencido",
      "storesWithStock": 0,
      "storeShare": 0
    },
    {
      "productId": "c3d07d8b-22db-4094-8ccd-5e6e6c4cafde",
      "productName": "Leche entera",
      "status": "vencido",
      "storesWithStock": 0,
      "storeShare": 0
    }
  ],
  "byStore": [
    {
      "storeId": "8917e994-8cee-4260-969b-bcdd9ae8911e",
      "disponible": false,
      "coverage": null,
      "covered": 0,
      "missing": 0
    }
  ]
}
```

XML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zoneCoverageResponse xmlns="availability/v1">
  <zoneId>ae673d60-571e-4993-bf85-4e9f21c11e24</zoneId>
  <validDays>7</validDays>
  <stores>1</stores>
  <basics>2</basics>
  <covered>0</covered>
  <disponible>false</disponible>
  <motivo>Ninguna tienda de la zona tiene datos vigentes (7 días) de productos de la canasta básica (D-38).</motivo>
  <items>
    <item>
      <productId>c80752ec-84b1-44d2-b1b9-687740fb1fea</productId>
      <productName>Frijol negro</productName>
      <status>vencido</status>
      <storesWithStock>0</storesWithStock>
      <storeShare>0</storeShare>
    </item>
    <item>
      <productId>c3d07d8b-22db-4094-8ccd-5e6e6c4cafde</productId>
      <productName>Leche entera</productName>
      <status>vencido</status>
      <storesWithStock>0</storesWithStock>
      <storeShare>0</storeShare>
    </item>
  </items>
  <byStore>
    <item>
      <storeId>8917e994-8cee-4260-969b-bcdd9ae8911e</storeId>
      <disponible>false</disponible>
      <covered>0</covered>
      <missing>0</missing>
    </item>
  </byStore>
</zoneCoverageResponse>
```

El Investigador de mercado → `403`:

```json
{
  "statusCode": 403,
  "message": "Forbidden resource",
  "code": "FORBIDDEN",
  "details": null,
  "path": "/v1/availability/zones/ae673d60-571e-4993-bf85-4e9f21c11e24/coverage",
  "timestamp": "2026-11-25T23:46:22.654Z"
}
```

## Tabla de acuses para offline-sync (T-17)

| HTTP | `status` | Acuse |
|---|---|---|
| 201 | `aceptada` | aceptada |
| 201 | `conflicto` | conflicto (no sobrescribió) |
| 200 | `duplicada` | duplicada |
| 409 | — | conflicto (id usado por otro usuario; generar otro) |
| 400 | — | rechazada |
| 503 | — | reintentar más tarde |

Los mismos acuses aplican a `POST /v1/price-observations` (pricing, `observationId`) y a
`POST /v1/field-visits` (catalog, `visitId`): ver sus contratos.
