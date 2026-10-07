# Contrato: M06/M07 en core-process-service (Fase A)

Base: `http://core-process-service:3104` · Rutas `/v1/transactions` y
`/v1/baskets`, JSON por defecto y XML si `Accept` pide XML
(`application/xml`, `text/xml` o `*+xml`, respetando q-values).
Escritura para Administrador y Analista; lectura para perfiles internos.

XSD por endpoint en `docs/contratos/xsd/core-process/`. Los errores
también salen en XML cuando se piden así, con el XSD `error.xsd`.

## POST /v1/transactions (Admin, Analista)

Registro manual. El `total` se calcula del detalle (no se acepta del
cliente) **replicando el redondeo por línea de Postgres**, y antes de
confirmar la transacción de base de datos se verifica que sea igual a la
Σ de los `subtotal` materializados; si no coincide, nada se guarda.
Folio único por tienda. Cada transacción construye su canasta **en la
misma transacción de base de datos** (RN-03): o quedan las dos o ninguna.

Request JSON:

```json
{ "storeId": "uuid-tienda", "folio": "T-2026-0001", "fecha": "2026-09-18",
  "details": [{ "presentationId": "uuid-pres", "quantity": 2, "unitPrice": 42.5 }] }
```

`quantity` y `unitPrice` admiten **máximo 2 decimales** (las columnas son
`NUMERIC(10,2)` y `NUMERIC(12,2)`: un tercer decimal descuadraría el
total). `fecha` no puede ser futura. La misma presentación repetida en
`details` → 400 (suma las cantidades en una línea). Presentación de un
producto que no esté `activo` → 400, igual que en el CSV.

Response `201`: la transacción con tienda, detalle y presentaciones
(`xsd/core-process/transaction.xsd`).

Errores: 400, 401, 403, 404 (tienda inexistente), 409 (folio duplicado),
503 (catálogo caído).

## POST /v1/transactions/import/preview (Admin, Analista, multipart)

Valida **sin insertar nada en transacciones**: las filas quedan en
staging con su resultado por fila. Campo `file`, solo `.csv`, máximo
5 MB (se rechaza en el borde). Columnas
`folio,fecha,tienda,sku,presentacion,cantidad,precio` (cualquier orden,
`,` o `;`, insensible a mayúsculas y espacios). Códigos por fila:
`FOLIO_VACIO`, `FECHA_VACIA`, `FECHA_INVALIDA`, `FECHA_FUTURA`,
`TIENDA_VACIA`, `TIENDA_NO_EXISTE`, `SKU_VACIO`, `SKU_NO_EXISTE`,
`PRODUCTO_INACTIVO`, `PRESENTACION_VACIA`, `PRESENTACION_NO_EXISTE`,
`PRESENTACION_DUPLICADA`, `CANTIDAD_INVALIDA`, `PRECIO_INVALIDO`,
`VALOR_DEMASIADO_LARGO`.

Una fila mala **no aborta el archivo**. `cantidad` y `precio` deben ser
decimales planos de hasta 2 decimales (`1e3`, `0x10` y `0.001` se
rechazan como `CANTIDAD_INVALIDA`).

La validación contra el catálogo corre **antes** de persistir: si
catalog-service responde 503, no queda ninguna cabecera con el hash de
ese archivo, así que se puede volver a subir cuando el catálogo regrese.
Archivo repetido (mismo hash, no descartado) → 409 con el id de la
importación previa.

Response `201` con `importacionId`, conteos, `grupos` y hasta 200
`errores` (`xsd/core-process/csv-preview.xsd`).

Errores: 400, 401, 403, 409, 413 (>5 MB), 415 (no es CSV), 503.

## POST /v1/transactions/import/confirm (Admin, Analista)

`{ "previewId": "uuid" }` → inserta **solo las filas válidas**. Cada
folio entra completo o no entra: venta, líneas, canasta y la
trazabilidad de las filas del CSV van en **una sola transacción de base
de datos**. Los folios que no se pudieron insertar se reportan en
`omitidos` con su motivo (`FOLIO_DUPLICADO`, `ERROR_INSERCION`), y el
motivo nunca filtra el texto crudo del motor de base de datos. Audita el
evento a `audit-service` (best-effort: si no responde, la importación
igual queda y el fallo se registra en el log).

Response `200` con el resumen de lo realmente insertado
(`xsd/core-process/csv-confirm.xsd`):

```json
{ "importacionId": "uuid", "estado": "confirmado",
  "filasTotales": 154, "filasValidas": 154, "filasConError": 0,
  "lineasInsertadas": 154, "transaccionesCreadas": 100,
  "canastasCreadas": 100, "omitidos": [], "errores": [] }
```

Ya confirmada / descartada / sin validar → 409. Sin filas válidas → 400.

## GET /v1/transactions/import/pending (Admin, Analista)

Importaciones en `validado` o `con_errores` para retomar
(`xsd/core-process/imports-pending.xsd`).

## GET /v1/transactions y GET /v1/transactions/:id

`?storeId&dateFrom&dateTo&page&limit`. Filtros opcionales y combinables
con AND; `dateTo` incluye el **día completo**. Ordenado por fecha
descendente. Devuelve la envoltura de paginación estándar
(`paginacion.md`): `{data,total,page,limit}`
(`xsd/core-process/transactions-page.xsd`).

## GET /v1/baskets y GET /v1/baskets/:id

Una transacción = una canasta, con zona y segmento congelados al
construirla. `numero_productos` cuenta **productos distintos**, no
líneas de detalle: dos presentaciones del mismo producto son un producto.

Filtros, todos opcionales y combinables con AND (intersección, nunca
unión): `storeId`, `zoneId`, `segmentId`, `dateFrom`, `dateTo`
(día completo), `minTotalValue`, `maxTotalValue`, `minProductCount`,
`maxProductCount`, `hasBasicProducts` (`true`/`false`), `size`
(`chica|mediana|grande`, RN-05, resuelto contra `tamanos_compra`), más
`page` y `limit`. Sin resultados → `data: []`, no error.

`segmentId` es nulo mientras la zona no tenga clasificación vigente: la
canasta se construye igual y se puede reclasificar después
(`BasketsService.classifyByZoneAndSegment`).

Respuesta paginada (`xsd/core-process/baskets-page.xsd`) y detalle
(`xsd/core-process/basket.xsd`).
