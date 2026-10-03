# Contrato: M09 analítica en core-process-service (Fase A)

Base: `http://core-process-service:3104` · Rutas `/v1/analytics/*`, JSON por
defecto y XML si `Accept: application/xml`. Filtros `AnalyticsFilterDto`
(`storeId`, `zoneId`, `segmentId`, `dateFrom`, `dateTo`, todos opcionales y
combinables) con los mismos nombres del monolito — no `periodStart/periodEnd`.

## GET /v1/analytics/average-ticket → `number` (MXN por canasta)
## GET /v1/analytics/products-per-basket → `number`
## GET /v1/analytics/units-per-transaction → `number`
## GET /v1/analytics/purchase-frequency → `number` (canastas por mes)

Frecuencia agregada por zona (RN-02), nunca por cliente: `canastas / meses`
del periodo; `dateTo` inclusivo; sin canastas → `0`.

## GET /v1/analytics/spend-by-category → `CategorySpend[]`

```json
[{ "categoryId": 3, "categoryName": "Lácteos", "totalSpend": 1520.5,
   "units": 42, "basketCount": 18, "share": 23.75 }]
```

Gasto por categoría directa del producto, de mayor a menor; `share` en 0–100.
