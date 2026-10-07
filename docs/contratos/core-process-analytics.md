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
