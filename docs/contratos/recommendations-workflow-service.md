# Contrato: recommendations-workflow-service (T-07 · Sprint 4)

Base: `http://recommendations-workflow-service:3117` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`recommendations-workflow-service.xsd`, namespace `workflow/v1`). Acepta cuerpos JSON o
XML (`Content-Type: application/xml`, raíz indicada en cada ruta, mismo `xmlns`; XML mal
formado, raíz distinta o con `DOCTYPE`/`ENTITY` → `400`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}` y los códigos de
`services/snippets/error-codes.md`. Listados paginados según `paginacion.md`.

Plantilla: `services/template-nest/` (con T-02: `X-Correlation-Id` y health con
dependencias). `GET /v1/health` sigue `health.xsd`.

Decisiones que aplica: **D-41** (seguimiento de recomendaciones aprobadas, estados, quién
asigna, mueve y evalúa), **D-12** (genera el Planeador, decide el Gerente; se avisa al
Auditor), **D-26** (solo ids de usuario) y **D-46** (avisos informativos se pueden apagar).

> **PROPUESTA** = lo propone Fernando, falta pasarlo a la Matriz. **PENDIENTE** = no se
> implementa hasta que se acuerde.

---

## 1. Rutas (todas nuevas)

| Método | Ruta | Qué hace | Raíz XML |
|---|---|---|---|
| POST | `/v1/workflow/assignments` | El Gerente asigna responsable a una recomendación aprobada (estado `asignada`) | petición `asignacionRequest` · respuesta `seguimientoResponse` |
| GET | `/v1/workflow/assignments` | Lista paginada | `seguimientoListResponse` |
| GET | `/v1/workflow/assignments/:id` | Un seguimiento | `seguimientoResponse` |
| PATCH | `/v1/workflow/assignments/:id/start` | El asignado inicia: `asignada` → `en_implementacion` | `seguimientoResponse` |
| PATCH | `/v1/workflow/assignments/:id/implement` | El asignado marca implementada: `en_implementacion` → `implementada` | petición `implementacionRequest` · respuesta `seguimientoResponse` |
| PATCH | `/v1/workflow/assignments/:id/evaluate` | El Gerente evalúa con la métrica de impacto: `implementada` → `evaluada` | petición `evaluacionRequest` · respuesta `seguimientoResponse` |
| GET | `/v1/workflow/assignments/:id/history` | Eventos: actor, fechas, correlación y estado de auditoría y avisos | `historialSeguimientoResponse` |
| GET | `/v1/health` | Estado del servicio (sin autenticación) | `response` (`health.xsd`) |

`:id` es el UUID del **seguimiento** (no el de la recomendación); otro valor → `400`.

## 2. Autenticación, permisos y correlación

### Autenticación

Todas las rutas, menos `GET /v1/health`, exigen `Authorization: Bearer <accessToken>`
**y** sesión activa en Redis (`SessionGuard`). Sin token, token expirado, manipulado o
sesión revocada → `401`. El actor de cada operación sale **del token**; el cuerpo no acepta
`assignedBy`, `evaluatedBy`, `status` ni `variationPct` (→ `400`).

### Fila de la Matriz §3.2

| Admin | Analista | Gerente | Resp. precios | Planeador | Auditor | Proveedor | Investigador |
|---|---|---|---|---|---|---|---|
| L | L + mueve estados **si es el asignado** | **Asigna y evalúa** (+ L) | L + mueve estados **si es el asignado** | L + mueve estados **si es el asignado** | L | – | – |

D-41 fija: el **Gerente de categoría asigna y evalúa** y **el responsable asignado mueve
los estados**. Lo demás es **PROPUESTA**:

- **Lectura:** los 6 perfiles internos leen todos los seguimientos, igual que leen las
  recomendaciones en M14 (todos tienen L ahí). Proveedor e Investigador → `403` (D-28).
- **Quién puede ser responsable asignado (PROPUESTA):** `Analista comercial`,
  `Responsable de precios` y `Planeador`. Son los perfiles operativos que ejecutan los
  cambios que proponen las reglas (accesibilidad y asociación → Analista; precio y
  elasticidad → Responsable de precios, el único que cambia precios por D1; formatos y
  empaques → Planeador). **No** se asignan: el Gerente (quien evalúa no implementa lo que
  evalúa), el Administrador y el Auditor (perfiles de control), ni Proveedor ni
  Investigador.

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/workflow/assignments` | `Gerente de categoría` |
| PATCH | `/:id/start`, `/:id/implement` | **Solo el usuario asignado** (y su rol debe ser asignable) |
| PATCH | `/:id/evaluate` | `Gerente de categoría` |
| GET | `/v1/workflow/assignments`, `/:id`, `/:id/history` | Los 6 perfiles internos |

**Usuario ajeno.** Como los 6 internos **leen** todos los seguimientos, un usuario que no es
el asignado y quiere moverlo recibe `403` (no `404`: el recurso ya es visible para él, no
hay nada que ocultar). El Gerente que intenta iniciar o marcar implementada → `403`.

### Correlación (`X-Correlation-Id`, T-02)

- Se acepta si cumple `^[A-Za-z0-9._:-]{1,100}$`; si falta o no cumple, se genera un UUID.
  Se devuelve siempre en el encabezado de la respuesta (también en errores).
- Va en cada línea de log; en cada llamada a decision-service, audit-service y
  notifications-service (con el `Authorization` del usuario); en la columna
  `correlation_id` de cada evento (`seguimiento_eventos`), visible en `/:id/history`.

## 3. Unidades, ids y zona horaria

| Dato | Formato |
|---|---|
| `id`, `recommendationId`, `assigneeUserId`, `assignedBy`, `evaluatedBy`, `actorId`, ids del `scope` | UUID (usuarios: solo el id; el nombre lo pide el cliente a auth-service, D-26) |
| `assignedAt`, `startedAt`, `implementedAt`, `evaluatedAt`, `at` | Instante ISO 8601 en **UTC** (`…Z`), reloj del servidor |
| `dueDate`, `implementedOn`, `before.from/to`, `after.from/to` | `YYYY-MM-DD`, **día local de America/Monterrey** (UTC−06:00), inclusivos. Variable `BUSINESS_TIMEZONE` |
| `value` de un periodo | Número ≥ 0, 2 decimales, en la unidad de `unit` |
| `unit` | `pza` (ventas en unidades), `MXN` (ventas en importe), `MXN/kg`, `MXN/l`, `MXN/pza` (precio unitario) |
| `variationPct` | Porcentaje (`15` = +15 %), 2 decimales; lo calcula el servidor |

## 4. Estados (D-41)

```
(recomendación ACEPTADA en decision-service)
   └─► Gerente asigna ─► ASIGNADA ─► asignado inicia ─► EN_IMPLEMENTACION
          ─► asignado marca ─► IMPLEMENTADA ─► Gerente evalúa ─► EVALUADA (final)
```

| Transición | Ruta | Quién | Desde |
|---|---|---|---|
| — → `asignada` | `POST /v1/workflow/assignments` | Gerente de categoría | recomendación `aceptada` |
| `asignada` → `en_implementacion` | `PATCH /:id/start` | el asignado | `asignada` |
| `en_implementacion` → `implementada` | `PATCH /:id/implement` | el asignado | `en_implementacion` |
| `implementada` → `evaluada` | `PATCH /:id/evaluate` | Gerente de categoría | `implementada` |

- **Salto fuera de orden → `409`** (p. ej. evaluar una `asignada`, o marcar implementada sin
  iniciar). Repetir una transición ya hecha (iniciar dos veces) también es `409`. El
  `details` dice el estado actual y el pedido.
- Cada transición es atómica (`UPDATE … WHERE id = $1 AND estado = '<desde>'`): si dos
  llegan a la vez, una pasa y la otra recibe `409`.
- **"Aprobada" = `aceptada`.** D-41 habla de recomendación "aprobada"; en decision-service
  ese estado se llama `aceptada` (`propuesta` | `aceptada` | `descartada`).
- **PENDIENTE:** reasignar a otro responsable, cancelar un seguimiento y regresar de estado.
  Ninguna decisión los define; hoy no hay rutas para eso.

## 5. POST /v1/workflow/assignments (Gerente de categoría)

1. Valida el cuerpo.
2. **Verifica por HTTP que la recomendación esté aprobada** (no lee la tabla de
   decision-service): `GET {DECISION_SERVICE_URL}/v1/recommendations/:recommendationId/explain`,
   reenviando `Authorization` y `X-Correlation-Id`, timeout 3 s.
   - `404` de decision-service → `404` aquí.
   - `status` distinto de `aceptada` (`propuesta` o `descartada`) → `409`.
   - Sin respuesta o `5xx` → `503`.
3. **Reintento sin doble asignación.** Hay **un solo seguimiento por recomendación**
   (llave única `recomendacion_id`):
   - Ya existe y el `assigneeUserId` es el mismo → `200` con el seguimiento existente (en el
     estado en que esté). **No** se crea otro, **no** se audita ni se avisa otra vez.
   - Ya existe con **otro** responsable → `409` (la reasignación es PENDIENTE).
   - Dos asignaciones simultáneas: la llave única deja pasar una (`201`) y la otra recibe el
     resultado de la regla anterior.
4. Guarda (`201`), audita y avisa (§10).

| Campo | Regla |
|---|---|
| `recommendationId` | obligatorio, UUID |
| `assigneeUserId` | obligatorio, UUID; distinto del Gerente que asigna (→ `400`) |
| `dueDate` | opcional, `YYYY-MM-DD` ≥ hoy (fecha compromiso; solo informativa, no cambia estados) |
| `note` | opcional, 10 a 1000 caracteres |

> **PENDIENTE con Juan Ángel:** validar que `assigneeUserId` existe, está activo y tiene un
> rol asignable. auth-service solo deja leer usuarios al Administrador y al Auditor, así que
> con el token del Gerente no se puede. Hace falta una ruta de auth-service que el Gerente
> pueda consultar (o un token de servicio). Mientras tanto, el rol del asignado se revisa
> con **su** token cuando intenta iniciar (`403` si su rol no es asignable).

Válido (JSON):

```json
{
  "recommendationId": "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  "assigneeUserId": "3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e",
  "dueDate": "2026-11-15",
  "note": "Aplicar el ajuste de precio del arroz 1 kg en Zona Centro."
}
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<asignacionRequest xmlns="workflow/v1">
  <recommendationId>9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b</recommendationId>
  <assigneeUserId>3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e</assigneeUserId>
  <dueDate>2026-11-15</dueDate>
  <note>Aplicar el ajuste de precio del arroz 1 kg en Zona Centro.</note>
</asignacionRequest>
```

Response `201` (`200` si fue un reintento con el mismo responsable):

```json
{
  "id": "6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e",
  "recommendationId": "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  "status": "asignada",
  "assigneeUserId": "3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e",
  "assignedBy": "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d",
  "assignedAt": "2026-10-30T17:00:00.000Z",
  "dueDate": "2026-11-15",
  "assignmentNote": "Aplicar el ajuste de precio del arroz 1 kg en Zona Centro.",
  "startedAt": null,
  "implementedOn": null, "implementedAt": null, "implementationNote": null,
  "evaluatedBy": null, "evaluatedAt": null, "evaluation": null
}
```

Rechazo — recomendación no aprobada (`409`), en XML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<error xmlns="workflow/v1">
  <statusCode>409</statusCode>
  <message>La recomendación no está aprobada; solo una recomendación aceptada entra al seguimiento.</message>
  <code>CONFLICT</code>
  <details>
    <item>estado en decision-service: propuesta</item>
  </details>
  <path>/v1/workflow/assignments</path>
  <timestamp>2026-10-30T17:00:00.000Z</timestamp>
</error>
```

Rechazo — reintento con **otro** responsable (`409`):

```json
{ "statusCode": 409, "message": "La recomendación ya tiene responsable asignado; la reasignación no está definida.",
  "code": "CONFLICT", "details": ["seguimiento: 6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e"],
  "path": "/v1/workflow/assignments", "timestamp": "2026-10-30T17:05:00.000Z" }
```

Otros: recomendación inexistente → `404`; un Planeador asigna → `403`; decision-service sin
responder → `503`.

## 6. PATCH /v1/workflow/assignments/:id/start (el asignado)

Sin cuerpo. `asignada` → `en_implementacion`, guarda `startedAt`.

Válido: el usuario `3b4c5d6e-…` (Responsable de precios, asignado) → `200`,
`seguimientoResponse` con `status: "en_implementacion"` y `startedAt`.

Rechazo — usuario ajeno: otro Responsable de precios (no asignado) → `403`:

```json
{ "statusCode": 403, "message": "Solo el responsable asignado puede mover este seguimiento.", "code": "FORBIDDEN",
  "details": null, "path": "/v1/workflow/assignments/6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e/start",
  "timestamp": "2026-10-31T15:00:00.000Z" }
```

Otros: ya iniciado → `409`; inexistente → `404`.

## 7. PATCH /v1/workflow/assignments/:id/implement (el asignado)

`en_implementacion` → `implementada`. Guarda `implementedOn` (día en que quedó aplicado),
`implementedAt` (instante del registro) y la nota.

| Campo | Regla |
|---|---|
| `implementedOn` | opcional (por omisión, hoy), `YYYY-MM-DD`; entre el día de `startedAt` y hoy → si no, `400` |
| `note` | obligatorio, 10 a 1000 caracteres: qué se hizo |

```json
{ "implementedOn": "2026-11-01", "note": "Precio del arroz 1 kg bajado de $27.50 a $25.00 en las tiendas de Zona Centro." }
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<implementacionRequest xmlns="workflow/v1">
  <implementedOn>2026-11-01</implementedOn>
  <note>Precio del arroz 1 kg bajado de $27.50 a $25.00 en las tiendas de Zona Centro.</note>
</implementacionRequest>
```

Válido → `200` con `status: "implementada"`.

Rechazo — salto de estado: marcar implementada un seguimiento todavía `asignada` (`409`):

```json
{ "statusCode": 409, "message": "Transición fuera de orden.", "code": "CONFLICT",
  "details": ["estado actual: asignada", "transición pedida: implementada", "primero se inicia (start)"],
  "path": "/v1/workflow/assignments/6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e/implement",
  "timestamp": "2026-10-31T15:00:00.000Z" }
```

Otros: `note` corta o `implementedOn` futura → `400`; usuario ajeno → `403`.

## 8. PATCH /v1/workflow/assignments/:id/evaluate (Gerente de categoría)

`implementada` → `evaluada` (final). El Gerente registra la **métrica de impacto** con un
periodo **antes** y uno **después** de la implementación; el servidor calcula
`variationPct = (after.value − before.value) / before.value × 100`, redondeado a 2
decimales al final.

| Campo | Regla |
|---|---|
| `metric` | `ventas_unidades` \| `ventas_importe` \| `precio_unitario` (D-41: ventas o precio unitario) |
| `unit` | Debe corresponder a la métrica: `ventas_unidades` → `pza`; `ventas_importe` → `MXN`; `precio_unitario` → `MXN/kg`, `MXN/l` o `MXN/pza`. Otra combinación → `400` (unidades incompatibles) |
| `scope` | Dónde se midió: `zoneId`, `storeId`, `presentationId` (UUID). Al menos uno; `precio_unitario` exige `presentationId` (D-06: nunca se mezclan presentaciones) |
| `before`, `after` | `from` ≤ `to`; `before.to` < día de implementación ≤ `after.from`; `after.to` ≤ hoy |
| Duración | **PROPUESTA:** los dos periodos tienen el mismo número de días (si no, la comparación de ventas no es justa) → si no, `400` |
| `before.value` | > 0 (con 0 no hay variación definida: `400`, nunca `Infinity` ni `NaN`) |
| `after.value` | ≥ 0 (en `precio_unitario`, > 0) |
| `source` | obligatorio, 3 a 300 caracteres: **con qué datos** se midió (servicio y consulta) |
| `comment` | opcional, 10 a 1000 caracteres |

Los valores los captura el Gerente; obtenerlos solos de core-process (ventas) y pricing
(precio unitario) por HTTP es trabajo posterior (**PENDIENTE**, sin decisión).

**Casos de control** (prueba unitaria; registrarlos como decisión):

| Métrica | Antes | Después | `variationPct` |
|---|---|---|---|
| `ventas_unidades` (`pza`) | 1,000 | 1,150 | **15.00** |
| `precio_unitario` (`MXN/kg`) | 27.50 | 25.00 | **−9.09** |
| cualquiera | 0 | 10 | `400` (sin base) |

**Métrica sugerida por tipo de recomendación — PROPUESTA (no se impone, el Gerente elige):**

| Regla de decision-service que la generó | Métrica sugerida | Unidad |
|---|---|---|
| Accesibilidad baja en zona | `ventas_unidades` de los básicos en la zona | `pza` |
| Elasticidad / ajuste de precio | `precio_unitario` de la presentación | `MXN/kg`, `MXN/l` o `MXN/pza` |
| Simulación de formato o empaque | `ventas_unidades` de la presentación | `pza` |
| Asociación (venta cruzada) | `ventas_importe` en la zona o tienda | `MXN` |

Para sugerirla, decision-service tendría que exponer en `explain` qué regla generó la
recomendación (hoy no lo trae). Cambio en decision-service (Fernando), fuera de este
contrato.

Válido (JSON):

```json
{
  "metric": "precio_unitario",
  "unit": "MXN/kg",
  "scope": { "zoneId": "f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44", "presentationId": "8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e" },
  "before": { "from": "2026-10-02", "to": "2026-10-31", "value": 27.50 },
  "after":  { "from": "2026-11-01", "to": "2026-11-30", "value": 25.00 },
  "source": "pricing-service GET /v1/prices/variation, presentación arroz 1 kg, Zona Centro",
  "comment": "El precio por kilo bajó como se recomendó."
}
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<evaluacionRequest xmlns="workflow/v1">
  <metric>precio_unitario</metric>
  <unit>MXN/kg</unit>
  <scope>
    <zoneId>f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44</zoneId>
    <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
  </scope>
  <before><from>2026-10-02</from><to>2026-10-31</to><value>27.50</value></before>
  <after><from>2026-11-01</from><to>2026-11-30</to><value>25.00</value></after>
  <source>pricing-service GET /v1/prices/variation, presentación arroz 1 kg, Zona Centro</source>
  <comment>El precio por kilo bajó como se recomendó.</comment>
</evaluacionRequest>
```

Response `200` (`seguimientoResponse`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<seguimientoResponse xmlns="workflow/v1">
  <id>6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e</id>
  <recommendationId>9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b</recommendationId>
  <status>evaluada</status>
  <assigneeUserId>3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e</assigneeUserId>
  <assignedBy>2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d</assignedBy>
  <assignedAt>2026-10-30T17:00:00.000Z</assignedAt>
  <dueDate>2026-11-15</dueDate>
  <assignmentNote>Aplicar el ajuste de precio del arroz 1 kg en Zona Centro.</assignmentNote>
  <startedAt>2026-10-31T15:00:00.000Z</startedAt>
  <implementedOn>2026-11-01</implementedOn>
  <implementedAt>2026-11-01T18:00:00.000Z</implementedAt>
  <implementationNote>Precio del arroz 1 kg bajado de $27.50 a $25.00 en las tiendas de Zona Centro.</implementationNote>
  <evaluatedBy>2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d</evaluatedBy>
  <evaluatedAt>2026-12-01T16:00:00.000Z</evaluatedAt>
  <evaluation>
    <metric>precio_unitario</metric>
    <unit>MXN/kg</unit>
    <scope>
      <zoneId>f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44</zoneId>
      <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
    </scope>
    <before><from>2026-10-02</from><to>2026-10-31</to><value>27.50</value></before>
    <after><from>2026-11-01</from><to>2026-11-30</to><value>25.00</value></after>
    <variationPct>-9.09</variationPct>
    <source>pricing-service GET /v1/prices/variation, presentación arroz 1 kg, Zona Centro</source>
    <comment>El precio por kilo bajó como se recomendó.</comment>
  </evaluation>
</seguimientoResponse>
```

Rechazo — salto de estado: evaluar un seguimiento `en_implementacion` (`409`):

```json
{ "statusCode": 409, "message": "Transición fuera de orden.", "code": "CONFLICT",
  "details": ["estado actual: en_implementacion", "transición pedida: evaluada", "falta marcarla implementada"],
  "path": "/v1/workflow/assignments/6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e/evaluate",
  "timestamp": "2026-11-20T16:00:00.000Z" }
```

Rechazo — unidad que no corresponde a la métrica (`400`):

```json
{ "statusCode": 400, "message": "Unidades incompatibles.", "code": "VALIDATION_ERROR",
  "details": ["unit MXN no corresponde a la métrica precio_unitario (usa MXN/kg, MXN/l o MXN/pza)"],
  "path": "/v1/workflow/assignments/6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e/evaluate",
  "timestamp": "2026-12-01T16:00:00.000Z" }
```

Otros: el asignado intenta evaluar → `403`; `before.value: 0` → `400`; periodo `after` que
termina en el futuro → `400`.

## 9. Consultas

### GET /v1/workflow/assignments

Paginado, el más reciente (`assignedAt`) primero. Query opcional: `status`,
`assigneeUserId`, `recommendationId`, `mine=true` (los asignados al usuario del token).

Válido (`200`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<seguimientoListResponse xmlns="workflow/v1">
  <data>
    <item>
      <id>6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e</id>
      <recommendationId>9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b</recommendationId>
      <status>asignada</status>
      <assigneeUserId>3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e</assigneeUserId>
      <assignedBy>2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d</assignedBy>
      <assignedAt>2026-10-30T17:00:00.000Z</assignedAt>
      <dueDate>2026-11-15</dueDate>
    </item>
  </data>
  <total>1</total>
  <page>1</page>
  <limit>20</limit>
</seguimientoListResponse>
```

Rechazo: `status=aprobada` (no es un estado del seguimiento) → `400`; un Proveedor → `403`.

### GET /v1/workflow/assignments/:id

Válido: `200`, `seguimientoResponse`. Rechazo: inexistente → `404`; no UUID → `400`;
Investigador de mercado → `403`.

### GET /v1/workflow/assignments/:id/history

Un evento por transición, en orden cronológico. **No se pagina** (máximo 4 eventos;
excepción de `paginacion.md`). Registra actor, instante, correlación y si la auditoría y el
aviso salieron (`enviado` | `fallido` | `pendiente` | `no_aplica`).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<historialSeguimientoResponse xmlns="workflow/v1">
  <assignmentId>6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e</assignmentId>
  <data>
    <item>
      <event>asignada</event>
      <toStatus>asignada</toStatus>
      <actorId>2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d</actorId>
      <at>2026-10-30T17:00:00.000Z</at>
      <correlationId>0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f</correlationId>
      <audit>enviado</audit>
      <notification>enviado</notification>
    </item>
    <item>
      <event>iniciada</event>
      <fromStatus>asignada</fromStatus>
      <toStatus>en_implementacion</toStatus>
      <actorId>3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e</actorId>
      <at>2026-10-31T15:00:00.000Z</at>
      <correlationId>1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a</correlationId>
      <audit>enviado</audit>
      <notification>fallido</notification>
    </item>
  </data>
</historialSeguimientoResponse>
```

Rechazo: inexistente → `404`.

## 10. Auditoría y avisos (no bloqueantes)

Después de guardar, sin esperar su resultado para responder, timeout **1.5 s**, con el
`Authorization` del usuario y el `X-Correlation-Id`. Si fallan, la operación **igual se
completa** y queda evidencia: línea `WARN aviso_fallido` (correlación, destino, evento, id
del seguimiento, motivo) y `audit` / `notification = fallido` en el evento (visible en
`/:id/history`). Un reintento de asignación que devuelve `200` no audita ni avisa.

| Operación | Auditoría (`POST /v1/auditoria`, `tabla: "recomendacion_seguimientos"`) | Aviso — **PROPUESTA** |
|---|---|---|
| Asignar | `accion: "insert"`, `registroId`: id del seguimiento; `descripcion` con `recommendationId` y responsable | `seguimiento.asignado`: origen Gerente → el usuario asignado (`recipientUserId`) |
| Iniciar | `accion: "update"`, `cambios: [{campo: "estado", previo: "asignada", posterior: "en_implementacion"}]` | `seguimiento.avance`: origen el asignado → el Gerente que asignó (`recipientUserId`) |
| Marcar implementada | `accion: "update"`, `cambios` de `estado` y `implementado_el` | `seguimiento.avance` |
| Evaluar | `accion: "update"`, `cambios` de `estado`, `metrica`, `variacion_pct` | `seguimiento.evaluado`: origen Gerente → el asignado, con copia al rol Auditor (como D-12) |

Los tres avisos son **informativos** (D-46: se pueden apagar). Ninguno es de aprobación
pendiente.

**Dependencia con Juan Ángel (bloqueante):** agregar `recommendations-workflow-service` a
`servicio` de audit-service y a `sourceService` de notifications-service, y los tres
eventos al catálogo cerrado (T-20 ya menciona "avisos nuevos de tareas").

## 11. Persistencia

PostgreSQL, tablas **nuevas** de este servicio (las agrega su responsable a `db/schema.sql`
con comentario de dueño; T-03/T-16). No usa MongoDB. Redis solo para la sesión: la
idempotencia de la asignación la da la llave única, no Redis.

| Tabla | Contenido |
|---|---|
| `recomendacion_seguimientos` | Un seguimiento por recomendación (`recomendacion_id` **único**, sin llave foránea a `recomendaciones`: se valida por HTTP). Responsable, quién asignó, fechas, estado, nota de implementación, evaluación (métrica, unidad, alcance, periodos, valores, `variacion_pct`, fuente, comentario) |
| `seguimiento_eventos` | Solo se anexa: evento, estado previo y nuevo, actor, instante, `correlation_id`, `auditoria_estado`, `aviso_estado` |

## 12. Códigos de error

| Status | Cuándo |
|---|---|
| `400` | Cuerpo o query inválidos; campo no permitido; ids no UUID; `assigneeUserId` igual al Gerente; `dueDate` pasada; `note` fuera de rango; `implementedOn` fuera de rango; unidad que no corresponde a la métrica; periodos mal ordenados, de distinta duración o con `after` en el futuro; `before.value` = 0 |
| `401` | Sin token, token revocado o sin sesión en Redis |
| `403` | Rol sin permiso sobre la ruta; usuario que no es el asignado intenta mover el estado; rol del asignado no asignable |
| `404` | Seguimiento inexistente; recomendación inexistente en decision-service |
| `409` | Recomendación no aprobada (`propuesta` o `descartada`); ya tiene otro responsable; salto de estado o transición repetida; dos transiciones simultáneas |
| `503` | decision-service no responde en 3 s; PostgreSQL caído (D-25); Redis sin responder al validar la sesión |

## 13. GET /v1/health

Sin autenticación; siempre `200` si el proceso responde. Usa PostgreSQL y Redis; MongoDB
sale `"no configurado"`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<response>
  <status>ok</status>
  <service>recommendations-workflow-service</service>
  <version>1.0.0</version>
  <checks>
    <postgres>ok</postgres>
    <mongodb>no configurado</mongodb>
    <redis>ok</redis>
  </checks>
  <latencyMs><postgres>2</postgres><mongodb>0</mongodb><redis>1</redis></latencyMs>
  <durationMs>4</durationMs>
  <timestamp>2026-10-30T15:00:00.000Z</timestamp>
</response>
```

Degradado (Redis caído): `status: "degraded"`, `checks.redis: "error: …"`; las rutas de
negocio responden `503` porque no se puede validar la sesión.
