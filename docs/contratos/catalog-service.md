# Contrato: catalog-service (Fase A — revisado en equipo antes de clientes)

Base: `http://catalog-service:3102` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`catalog-service.xsd`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}`. Listados paginados según
`paginacion.md`. Todas las rutas requieren `Authorization: Bearer <accessToken>` y
sesión activa en Redis (`SessionGuard`).

Rutas y campos en **inglés**, igual que `Contrato_Metodos_Endpoints` (Sprint 1).

> Secciones de este contrato, en orden de migración desde el monolito:
> `/v1/segments` (esta versión) · `/v1/stores` · `/v1/zones` · `/v1/products`.
> Cada una se agrega al migrarse su módulo.

---

## /v1/segments — Segmentos de ingreso (M05)

Un segmento clasifica **zonas agregadas**, nunca personas ni compras individuales
(RN-02). `source`, `updateFrequency`, `zoneRelation` y `limitations` son obligatorios:
cada segmento debe justificar de dónde sale su rango, cada cuánto se actualiza, cómo
se relaciona con la zona y qué limitaciones tiene.

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/segments` | Los 6 perfiles internos |
| GET | `/v1/segments/:id` | Los 6 perfiles internos |
| POST | `/v1/segments` | Administrador, Analista comercial |
| PATCH | `/v1/segments/:id` | Administrador, Analista comercial |
| DELETE | `/v1/segments/:id` | Administrador |

El Proveedor no tiene acceso a ninguna ruta de segmentos (`403`).

### Objeto Segment

```json
{
  "id": 1,
  "code": "ING_1",
  "name": "Ingreso bajo",
  "incomeRangeMin": "0.00",
  "incomeRangeMax": "15000.00",
  "source": "INEGI - ENIGH, ingreso corriente trimestral por hogar (AMM)",
  "updateFrequency": "Anual, al publicarse la ENIGH",
  "zoneRelation": "Se asigna a la ZONA agregada (RN-02); nunca a una persona ni compra individual.",
  "limitations": "No captura variación de ingreso dentro de la misma zona.",
  "description": null
}
```

- `incomeRangeMin` / `incomeRangeMax` son **cadenas decimales** (`numeric(12,2)` en
  Postgres, para no perder precisión). `incomeRangeMax: null` = sin tope superior.
- `description` es opcional y puede ser `null`.

### GET /v1/segments

Query: `page`, `limit` (ver `paginacion.md`). Orden fijo: `incomeRangeMin` ascendente
(no "recientes primero"; los segmentos se leen de menor a mayor ingreso).

Response `200`:

```json
{ "data": [ { "id": 1, "code": "ING_1", "…": "…" } ], "total": 5, "page": 1, "limit": 20 }
```

### GET /v1/segments/:id

Response `200`: objeto Segment. Inexistente → `404`.

### POST /v1/segments

Request JSON:

```json
{
  "code": "ING_1",
  "name": "Ingreso bajo",
  "incomeRangeMin": 0,
  "incomeRangeMax": 15000,
  "source": "INEGI - ENIGH, ingreso corriente trimestral por hogar (AMM)",
  "updateFrequency": "Anual, al publicarse la ENIGH",
  "zoneRelation": "Se asigna a la ZONA agregada (RN-02); nunca a una persona ni compra individual.",
  "limitations": "No captura variación de ingreso dentro de la misma zona.",
  "description": "Opcional"
}
```

| Campo | Regla |
|---|---|
| `code` | obligatorio, ≤ 20 caracteres, único |
| `name` | obligatorio, ≤ 60 caracteres, único |
| `incomeRangeMin` | obligatorio, numérico |
| `incomeRangeMax` | opcional, numérico positivo; omitir = sin tope |
| `source`, `zoneRelation`, `limitations` | obligatorios, texto |
| `updateFrequency` | obligatorio, ≤ 60 caracteres |
| `description` | opcional |

Campos no listados → `400` (`forbidNonWhitelisted`). Response `201`: objeto Segment.
`code` o `name` repetido → `409`.

### PATCH /v1/segments/:id

Mismo cuerpo que POST con todos los campos opcionales. Response `200`: objeto
Segment actualizado. Inexistente → `404`; `code`/`name` ya usado por otro → `409`.

### DELETE /v1/segments/:id

Response `204` sin cuerpo. Inexistente → `404`. Si hay zonas clasificadas con el
segmento (`zona_clasificaciones.segmento_manual_id`) → `409`: reclasificarlas antes.

### Códigos de error de esta sección

| Status | Cuándo |
|---|---|
| 400 | Cuerpo inválido, campo desconocido o `:id` no numérico |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso sobre la ruta |
| 404 | Segmento inexistente |
| 409 | `code`/`name` duplicado, o borrado con zonas asociadas |

### Pendiente (no es parte de este contrato todavía)

- Reporte de cambios a auditoría (insert/update/delete) — se define cuando se
  coordine con `audit-service`.
