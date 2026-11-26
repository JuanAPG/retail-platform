# Contrato: M09 analítica en core-process-service (Fase A)

Base: `http://core-process-service:3104` · Rutas `/v1/analytics/*`, JSON por
defecto y XML si `Accept` pide XML. Filtros `AnalyticsFilterDto`
(`storeId`, `zoneId`, `segmentId`, `dateFrom`, `dateTo`, todos opcionales y
combinables) con los mismos nombres del monolito — no `periodStart/periodEnd`.
Los cinco filtros se aplican en los cinco indicadores.

XSD por endpoint en `docs/contratos/xsd/core-process/`: los cuatro
escalares usan `indicador-escalar.xsd` (devuelven un número desnudo, no un
objeto `clave`/`valor`), la lista usa `spend-by-category.xsd` y los errores
`error.xsd`.

## GET /v1/analytics/average-ticket → `number` (MXN por canasta)
## GET /v1/analytics/products-per-basket → `number`
## GET /v1/analytics/units-per-transaction → `number`
## GET /v1/analytics/purchase-frequency → `number` (canastas por mes)

`products-per-basket` promedia **productos distintos** por canasta: dos
presentaciones del mismo producto (500 ml y 1 L) cuentan como un producto,
no como dos.

`purchase-frequency` es agregada por zona (RN-02), nunca por cliente:
`canastas / meses` del periodo; `dateTo` inclusivo; sin canastas → `0`.

Los cuatro escalares devuelven `0` cuando no hay canastas en el ámbito de
los filtros (nunca `null` ni error).

## GET /v1/analytics/spend-by-category → `CategorySpend[]`

```json
[{ "categoryId": 3, "categoryName": "Lácteos", "totalSpend": 1520.5,
   "units": 42, "basketCount": 18, "share": 23.75 }]
```

Gasto por categoría directa del producto (no suma hacia `categoria_padre_id`),
de mayor a menor; `share` en 0–100. Las categorías sin ventas no aparecen.
Lista vacía si no hay canastas en el ámbito filtrado.

Un producto **sin categoría** se agrupa como `"Sin categoría"` con
`categoryId: null`, no se descarta. El join a categoría es LEFT por eso:
con INNER, ese gasto desaparecía del resultado y los `share` seguían
sumando 100 % sobre un total incompleto — se perdía dinero sin que nada lo
delatara. Hoy `productos.categoria_id` es `NOT NULL` y el caso es
inalcanzable, pero el error sería invisible si eso cambia.

---

## Lecturas agregadas para el Sprint 4 (rutas nuevas)

Dos rutas **nuevas, de solo lectura**, para los servicios de analítica del Sprint 4.
Las agrega Leonardo como cambio mínimo en este dominio (`CONTRIBUTING.md`: interfaz
indispensable, consumidores actuales intactos, revisión de Juan Ángel en el PR). No
cambian ninguna ruta ni tabla existente.

Por qué hacen falta: los consumidores necesitan saber **qué productos** llevan las
canastas de un grupo y **cuánto se vendió por semana**. Con las rutas que había, eso
obliga a descargar todas las transacciones en páginas de 100 y contarlas fuera; con el
dataset del Parcial 3 (cientos de miles de transacciones) son miles de peticiones por
consulta. Aquí Postgres hace el conteo en una sola consulta.

Comunes a las dos:

- Roles: los 6 perfiles internos (igual que los demás indicadores). Proveedor e
  Investigador de mercado → `403`.
- Parten de la **misma consulta base** que los 5 indicadores (`filteredBaskets`):
  `zoneId` y `segmentId` son los **congelados en la canasta** y `dateFrom`/`dateTo` son
  días locales de `America/Monterrey`, inclusivos. Así filtran exactamente igual.
- `asOf` (opcional, instante ISO 8601): **instantánea**. Solo cuentan las canastas
  construidas hasta ese instante (`canastas.construida_en ≤ asOf`; la canasta se crea en
  la misma transacción de base de datos que la venta). Sin `asOf`, el servidor toma el
  instante de la petición y lo devuelve: repetir la consulta con ese `asOf` da lo mismo
  aunque después entren ventas (D-15 de los consumidores).
- Sin paginar: son agregados acotados por sus filtros (excepción de `paginacion.md`).
- Importes y cantidades como **número** redondeado a 2 decimales, igual que los demás
  indicadores de este módulo.
- `dateFrom > dateTo` → `400`. Un parámetro desconocido o mal formado → `400`.

### GET /v1/analytics/weekly-sales (consumidor: demand-forecast-service, T-13)

Ventas de **un producto** agregadas por **semana y presentación**.

| Parámetro | Regla |
|---|---|
| `productId` | **obligatorio**, UUID |
| `zoneId` | opcional, UUID |
| `dateFrom`, `dateTo`, `asOf` | opcionales (ver arriba) |

```json
{ "productId": "3f6c2a10-8b4e-4c1d-9a7e-1b2c3d4e5f60",
  "zoneId": "97925ca4-3845-4e68-9660-46f781957b8c",
  "timezone": "America/Monterrey", "weekStartsOn": "monday",
  "asOf": "2026-11-25T18:04:11.902Z",
  "transactions": 1184, "stores": 4,
  "data": [ { "weekStart": "2026-07-06", "presentationId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "quantity": 214, "transactions": 61 },
            { "weekStart": "2026-07-06", "presentationId": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", "quantity": 79, "transactions": 48 } ] }
```

- `weekStart`: el lunes de la semana, en hora de Monterrey
  (`date_trunc('week', fecha AT TIME ZONE 'America/Monterrey')`). Solo aparecen las
  semanas con venta; el relleno con 0 lo hace el consumidor. Si `dateFrom` no cae en
  lunes (o `dateTo` en domingo), la semana del extremo sale **parcial**: solo trae los
  días dentro del filtro, y su `weekStart` puede ser anterior a `dateFrom` (p. ej.
  `dateFrom=2026-08-01`, sábado, da una primera semana `2026-07-27`). El consumidor
  decide si la descarta; demand-forecast-service ajusta sus fechas a semanas completas.
- `quantity`: suma de cantidades en la unidad de **la presentación** (no se mezclan
  presentaciones, D-06; la conversión a kg/l/pza la hace el consumidor).
- `transactions` de cada fila: transacciones de esa semana con esa presentación.
- `transactions` y `stores` del encabezado: transacciones y tiendas **distintas** con el
  producto en toda la ventana (cobertura de D-36). No se obtienen sumando las filas.
- Orden: `weekStart` y luego `presentationId`, ascendentes.
- Un producto sin ventas en el ámbito → `200` con `data: []` y conteos en 0. No es `404`:
  los productos son de catalog-service.
- XSD: `xsd/core-process/weekly-sales.xsd`.

### GET /v1/analytics/basket-products (consumidor: basket-analysis-service, T-12)

Para un grupo **zona + segmento**: canastas por periodo y, por producto, en cuántas
canastas **distintas** aparece y cuánto se gastó en él.

| Parámetro | Regla |
|---|---|
| `zoneId` | **obligatorio**, UUID |
| `segmentId` | **obligatorio**, entero ≥ 1 |
| `groupBy` | opcional: `week` (lunes) o `month` |
| `dateFrom`, `dateTo`, `asOf` | opcionales (ver arriba) |

```json
{ "zoneId": "97925ca4-3845-4e68-9660-46f781957b8c", "segmentId": 2,
  "dateFrom": "2026-10-01", "dateTo": "2026-10-31", "groupBy": null,
  "timezone": "America/Monterrey", "asOf": "2026-11-25T18:20:00.000Z",
  "periods": [ { "periodStart": null, "baskets": 100, "stores": 4, "totalSpend": 10983.5 } ],
  "data": [ { "periodStart": null, "productId": "a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c01",
              "productName": "Leche entera", "categoryId": 2, "basketsWithProduct": 62, "spend": 3534 } ] }
```

En JSON los campos nulos salen como `null`; en XML se omiten.

- `periods`: canastas, tiendas **distintas** con venta y gasto total de cada periodo. Sin
  `groupBy` hay **exactamente un** periodo (`periodStart: null`), aunque tenga 0 canastas.
  Con `groupBy`, un periodo por semana o mes **con canastas**, con su `periodStart`
  (lunes o día 1, hora de Monterrey), en orden ascendente.
- `data`: una fila por periodo y producto. `basketsWithProduct` es
  `COUNT(DISTINCT canasta)`: una canasta con dos presentaciones del mismo producto
  cuenta **una vez**. `spend` suma los subtotales del producto. Orden: `periodStart`,
  luego `basketsWithProduct` descendente y `productId`.
- `categoryId` se omite si el producto no tiene categoría (como en `spend-by-category`).
- Grupo sin canastas → `200` con un periodo en 0 (sin `groupBy`) o `periods: []` (con
  `groupBy`), y `data: []`.
- XSD: `xsd/core-process/basket-products.xsd`.

### Casos de control (CSV de 100 canastas sobre el seed)

| Consulta | Resultado esperado |
|---|---|
| `basket-products` Zona Valle, segmento 3 (Ingreso alto) | 1 periodo: 40 canastas, 1 tienda, gasto 5607.5; Leche entera y Frijol negro en 30 canastas, Quinoa orgánica en 10 |
| `basket-products` Zona Centro, segmento 2 | 32 canastas; Leche entera en 32, Queso panela en 24 |
| `basket-products` Zona Oriente, segmento 1 | 28 canastas; Frijol negro en 28 |
| `basket-products` Zona Valle con el segmento de otra zona | `periods` en 0 y `data: []` |
| `basket-products` con `groupBy=month` | Agosto y septiembre suman las canastas de la zona |
| Gasto total de `basket-products` | Igual a `average-ticket × canastas` con los mismos filtros |
| `weekly-sales` de un producto del CSV | La suma de `quantity` por presentación es igual a la suma de cantidades de esas líneas en `/v1/transactions` |
| `asOf` anterior a la carga del CSV | Conteos en 0 |
