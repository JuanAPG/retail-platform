# Contrato: M06/M07 en core-process-service (Fase A)

Base: `http://core-process-service:3104` · Rutas `/v1/transactions` y
`/v1/baskets`, JSON por defecto y XML si `Accept: application/xml`.
Escritura para Administrador y Analista; lectura para perfiles internos.

## POST /v1/transactions (Admin, Analista)

Registro manual. El `total` se calcula como Σ líneas (no se acepta total
declarado que contradiga el detalle); folio único por tienda; cada
transacción construye su canasta de inmediato (RN-03).

Request JSON:

```json
{ "storeId": "uuid-tienda", "folio": "T-2026-0001", "fecha": "2026-09-18",
  "details": [{ "presentationId": "uuid-pres", "quantity": 2, "unitPrice": 42.5 }] }
```

Response `201`: la transacción con tienda, detalle y presentaciones.

## POST /v1/transactions/import/preview (Admin, Analista, multipart)

Valida sin insertar. Columnas `folio,fecha,tienda,sku,presentacion,
cantidad,precio` (cualquier orden, `,` o `;`). Códigos por fila:
`FOLIO_VACIO`, `FECHA_VACIA`, `FECHA_INVALIDA`, `FECHA_FUTURA`,
`TIENDA_VACIA`, `TIENDA_NO_EXISTE`, `SKU_VACIO`, `SKU_NO_EXISTE`,
`PRODUCTO_INACTIVO`, `PRESENTACION_VACIA`, `PRESENTACION_NO_EXISTE`,
`PRESENTACION_DUPLICADA`, `CANTIDAD_INVALIDA`, `PRECIO_INVALIDO`.
Archivo repetido (mismo hash, no descartado) → 409. Response con
`importacionId`, conteos, grupos y hasta 200 errores.

## POST /v1/transactions/import/confirm (Admin, Analista)

`{ "previewId": "uuid" }` → inserta filas válidas, construye canastas,
omite folios duplicados (`FOLIO_DUPLICADO`) y audita a `audit-service`
(best-effort). Response con `transaccionesCreadas`, `canastasCreadas` y
`omitidos`. Ya confirmada/descartada/sin validar → 409.

## GET /v1/transactions/import/pending (Admin, Analista)

Importaciones en `validado` o `con_errores` para retomar.

## GET /v1/transactions[?storeId&dateFrom&dateTo] y GET /v1/transactions/:id

Lectura con filtros opcionales, ordenada por fecha descendente.

## GET /v1/baskets[?storeId&zoneId&segmentId&dateFrom&dateTo] y GET /v1/baskets/:id

Una transacción = una canasta, con zona y segmento congelados al
construirla. Filtros combinables (intersección); sin resultados → `[]`.
