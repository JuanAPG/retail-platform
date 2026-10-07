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

**Bajas lógicas del catálogo.** `activo: false` en catalog-service es una
baja lógica, no un borrado: la tienda o la presentación siguen
existiendo, así que hay que rechazarlas aquí. Una tienda dada de baja no
origina ventas (400) y una presentación dada de baja no se puede vender
(400); en el CSV son `TIENDA_INACTIVA` y `PRESENTACION_INACTIVA` por
fila. Si el catálogo **no** manda el campo `activo` (versión anterior), la
entidad cuenta como activa: interpretar `undefined` como inactivo
bloquearía todas las ventas contra un catálogo viejo.

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
`VALOR_DEMASIADO_LARGO`, `TIENDA_INACTIVA`, `PRESENTACION_INACTIVA`.

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

**Reanudable.** Solo toma las filas válidas que todavía no se
insertaron (las ya insertadas tienen `transaccion_id`), y la importación
se marca `confirmado` **únicamente** si no quedó ninguna pendiente. Si la
confirmación se interrumpe a medias —se cae la base, falla un folio— el
estado se conserva y un segundo `confirm` termina lo que falta sin
duplicar nada. Marcarla confirmada con filas pendientes las dejaba sin
ninguna vía de recuperación, porque el reintento respondía 409.

Un folio que ya existe en la base se omite, pero su fila de staging se
liga a esa transacción: es la trazabilidad correcta y evita que la
importación quede abierta para siempre por un folio que nunca se va a
insertar.

Response `200` con el resumen de lo realmente insertado
(`xsd/core-process/csv-confirm.xsd`):

```json
{ "importacionId": "uuid", "estado": "confirmado",
  "filasTotales": 154, "filasValidas": 154, "filasConError": 0,
  "lineasInsertadas": 154, "transaccionesCreadas": 100,
  "canastasCreadas": 100, "transaccionesTotales": 100,
  "filasPendientes": 0, "completa": true, "omitidos": [], "errores": [] }
```

`transaccionesCreadas` es lo insertado en **esta** llamada;
`transaccionesTotales` es el acumulado que hay en la base (se cuenta, no
se acumula en memoria). `completa: false` con `filasPendientes > 0`
significa que hay que reintentar.

Descartada / sin validar → 409. Sin filas válidas → 400. Ya confirmada
→ 409, **salvo** que tenga filas válidas sin insertar: entonces se retoma
para completarla (auto-reparación de importaciones que quedaron
inconsistentes).

## DELETE /v1/transactions/import/:id (Admin, Analista)

Descarta una importación no confirmada. `descartado` es el único estado
que libera el hash del archivo: sin esto, un preview equivocado dejaba
ese CSV rechazado con 409 para siempre.

Response `200` (`xsd/core-process/csv-discard.xsd`):

```json
{ "importacionId": "uuid", "fileName": "ventas.csv",
  "estado": "descartado", "estadoPrevio": "con_errores" }
```

Una importación ya confirmada **no** se puede descartar (sus
transacciones ya están en la base) → 409.

## GET /v1/transactions/import/pending (Admin, Analista)

Importaciones en `validado` o `con_errores` para retomar
(`xsd/core-process/imports-pending.xsd`). `filasPendientes` menor que
`filasValidas` significa que esa importación quedó **aplicada a medias** y
confirmarla de nuevo retoma solo lo que falta.

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
canasta se construye igual (no se bloquea la venta) y se rellena después
con `POST /v1/baskets/reclassify`.

## POST /v1/baskets/:id/reclassify[?resyncZone] (Admin, Analista)

Reclasifica UNA canasta contra la clasificación vigente de su zona.

Por defecto solo refresca el `segmentId`. Con `?resyncZone=true` vuelve a
derivar **la zona desde la tienda** de su transacción, que es la misma
regla que aplica la construcción de la canasta. No es el default porque
la zona se congela al construirla a propósito (RN-02: la clasificación
vigente *al momento* de la venta), y re-derivarla reescribiría el análisis
de meses pasados si la tienda cambió de zona desde entonces. Es para
corregir una canasta cuya zona quedó mal, no para uso rutinario.

Si la tienda no tuviera zona asignada responde **409** en vez de guardar
una canasta sin zona. Hoy es inalcanzable: `tiendas.zona_id` es `NOT
NULL`, así que una tienda nunca existe sin zona.

Response `200`: la canasta reclasificada (`xsd/core-process/basket.xsd`).

## POST /v1/baskets/reclassify[?zoneId] (Admin, Analista)

Rellena el segmento de las canastas que nacieron sin él. Hace falta
porque la corrida de clustering (RF-16) clasifica las zonas **después** de
que ya hay ventas: sin esto, esas canastas quedaban sin segmento para
siempre e invisibles para todo el análisis por nivel de ingreso.

**Solo llena huecos.** No reescribe el segmento de las canastas que ya lo
tienen: la clasificación se congela al construir la canasta a propósito
(RN-02, «reclasificar una zona hoy no debe reescribir el análisis de
meses pasados»).

Response `200` (`xsd/core-process/reclassify.xsd`):

```json
{ "canastasSinSegmento": 12, "canastasClasificadas": 12,
  "zonasSinClasificacion": [] }
```

`zonasSinClasificacion` lista las zonas que siguen sin clasificación
vigente: falta correr el clustering o asignarlas a mano en
catalog-service.

## Forma de las respuestas

Las respuestas **no** son las entidades crudas. `storeId`/`zoneId` vienen
acompañados de una referencia mínima `{id, nombre}` al catálogo, y nada
más de esas tablas viaja: este servicio no es dueño de ellas, y devolver
la entidad arrastraba `store.direccion.codigoPostal.municipio`,
`zone.municipioId`, `activo`, `updatedAt`… lo que rompía la validación
XSD en cuanto catalog-service agregaba una columna. `findAll` y `findOne`
devuelven exactamente la misma forma.

El detalle de la transacción expone `productId` plano aunque la tabla
**no** lo guarde (el producto sale por join desde la presentación, RF-35):
guardar ambos permitiría contradicción, exponerlo le ahorra al cliente
navegar el anidamiento.

Respuesta paginada (`xsd/core-process/baskets-page.xsd`) y detalle
(`xsd/core-process/basket.xsd`).
