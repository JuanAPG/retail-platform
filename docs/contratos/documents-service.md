# Contrato: documents-service (M16)

Base: `http://documents-service:3108` · Rutas `/v1/`, JSON por defecto y XML si
`Accept: application/xml` (XSD en `documents-service.xsd`, namespace `documents/v1`).
Errores con el cuerpo estándar. Requiere sesión (SessionGuard: JWT + sesión en Redis).

Este servicio es dueño de la colección MongoDB `reportes` (historial de reportes
ejecutivos). No escribe en Postgres. Variables: `MONGO_URL` (en compose),
`CORE_PROCESS_SERVICE_URL`, `CATALOG_SERVICE_URL`, `PRICING_SERVICE_URL`,
`ALGORITHMS_CORE_URL`, `DECISION_SERVICE_URL` y `AUDIT_SERVICE_URL` (con defaults por nombre
de servicio de Docker).

## Roles

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/reports/executive` | Gerente de categoría |
| GET | `/v1/reports` | Los 6 perfiles internos; Proveedor (solo los suyos) |
| GET | `/v1/reports/stats/by-user-month` | Los 6 perfiles internos; Proveedor (solo los suyos) |
| GET | `/v1/reports/:id` | Los 6 perfiles internos; Proveedor (solo los suyos) |
| GET | `/v1/reports/:id/export?format=pdf\|xlsx` | Los 6 perfiles internos; Proveedor (solo los suyos) |
| PATCH | `/v1/reports/:id` | Gerente de categoría |

**Aislamiento del Proveedor (DOC-04):** en el listado y la agregación se filtra por su
`usuarioId` (ignora `?usuarioId=`); pedir el reporte de otro es `404`, no `403`.

## Objeto Report

```json
{
  "id": "6705f1c2a3b4c5d6e7f80912",
  "tipo": "ejecutivo",
  "parametros": { "dateFrom": "2026-08-01", "dateTo": "2026-08-31", "zoneId": null, "segmentId": null },
  "formato": "json",
  "usuarioId": "uuid",
  "estado": "generado",
  "creadoEn": "2026-10-08T18:00:00.000Z",
  "secciones": [
    { "clave": "ticket_promedio", "nombre": "Ticket promedio (MXN por canasta)",
      "servicio": "core-process-service", "disponible": true, "valor": 86.4, "motivo": null },
    { "clave": "elasticidad_promedio", "nombre": "Elasticidad promedio",
      "servicio": "algorithms-core", "disponible": false, "valor": null,
      "motivo": "algorithms-core no respondió en 3 s." }
  ]
}
```

`estado`: `generado` | `exportado` (pasa a `exportado` al exportar a PDF). En XML los
nulos (`valor`, `motivo`, `zoneId`, `segmentId`) se omiten.

## POST /v1/reports/executive

Body: `{ "dateFrom": "YYYY-MM-DD", "dateTo": "YYYY-MM-DD", "zoneId"?: uuid, "segmentId"?: int }`.
`dateFrom` posterior a `dateTo` o campos extra → `400`.

Arma los **16 indicadores** (D-20) llamando por HTTP a los servicios dueños y reenviando el
`Authorization` del usuario:

| Servicio | Indicadores (`clave`) |
|---|---|
| core-process-service | `transacciones_analizadas`, `canastas` (una canasta = una transacción, RN-03), `ticket_promedio`, `productos_por_canasta`, `frecuencia_compra`, `categorias_principales` |
| catalog-service | `zonas_analizadas`, `productos_basicos_disponibles` |
| algorithms-core | `asociaciones_principales` (última corrida), `sustituciones`, `elasticidad_promedio`, `productos_mas_sensibles` |
| pricing-service | `variacion_precios` |
| decision-service | `accesibilidad_por_zona` (último valor del historial; no dispara un cálculo nuevo), `escenarios_creados`, `impacto_estimado` |

**Regla central:** si un servicio no responde (timeout de 3 s, 5xx o red), sus indicadores salen
`disponible: false` con su `motivo`, nunca como `0`. Un indicador sin datos en el periodo sale
`disponible: true` con `valor` vacío o `null`.

Response `201`: Report. Con MongoDB caído → `503`.

## GET /v1/reports

Query: `page`, `limit` (ver `paginacion.md`), `usuarioId`, `tipo`, `dateFrom`, `dateTo`
(filtran por la fecha de creación). Orden: más reciente primero.
Response `200`: `{ "data": [Report], "total": n, "page": 1, "limit": 20 }`. XML: `reportListResponse`.

## GET /v1/reports/stats/by-user-month

Agregación de MongoDB. Response `200`: `{ "data": [ { "usuarioId": "uuid", "mes": "2026-10", "reportes": 3 } ] }`.
XML: `reportStatsResponse`.

## GET /v1/reports/:id · PATCH /v1/reports/:id

`GET`: Report. `PATCH` body `{ "estado": "generado" | "exportado" }` (solo el Gerente).
`:id` mal formado → `400`; inexistente (o ajeno, para un Proveedor) → `404`.

## GET /v1/reports/:id/export?format=pdf|xlsx

Sale del documento guardado en MongoDB (mismos números que el JSON). Marca el reporte como `exportado` y audita `exportar`.
`format` ausente o distinto de `pdf` y `xlsx` → `400`.

- **`pdf`** (obligatorio, D-19): `Content-Type: application/pdf` y `Content-Disposition: attachment; filename="reporte-ejecutivo-<fecha>.pdf"`.
  Con acentos, ñ, `$` y `%`. Un reporte vacío o sin datos produce un PDF, nunca `500`.
- **`xlsx`** (opcional, D-19): `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  archivo `reporte-ejecutivo-<fecha>.xlsx`. Dos hojas: `Reporte` (periodo, zona, segmento, id) e `Indicadores`
  (servicio, indicador, valor, estado, nota). **Las cifras van como celdas numéricas**; un indicador no disponible va
  con estado `No disponible`, su motivo en la nota y la celda de valor vacía (nunca 0). Las listas dan una fila por elemento.

## MongoDB

Colección `reportes`: `{ _id, tipo, parametros, formato, usuarioId, estado, creadoEn, secciones }`.
Índices: `{ usuarioId: 1, creadoEn: -1 }` y `{ tipo: 1, creadoEn: -1 }`.

## Auditoría

Se reportan a audit-service (sin romper la operación si está caído): la generación
(`insert` sobre `reportes`) y la exportación (`exportar`).

## Códigos de error

| Status | Cuándo |
|---|---|
| 400 | Cuerpo o query inválidos, `:id` mal formado, `format` no soportado |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso sobre la ruta |
| 404 | Reporte inexistente o de otro usuario (Proveedor) |
| 503 | MongoDB no disponible |
