# Contrato: income-segmentation-service (T-05 · Sprint 4)

Base: `http://income-segmentation-service:3112` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`income-segmentation-service.xsd`, namespace `segmentation/v1`). Errores con el cuerpo
estándar `{statusCode, message, code, details, path, timestamp}`. Listados paginados
según `paginacion.md`. Todas las rutas (menos `GET /v1/health`) requieren
`Authorization: Bearer <accessToken>` y sesión activa en Redis (`SessionGuard`).

Plantilla: `services/template-nest/` (con T-02: `X-Correlation-Id` y health con
dependencias). `GET /v1/health` sigue `health.xsd`.

Decisiones que aplica: **D-35** (los segmentos y la clasificación de zonas salen de
catalog-service; cada cambio crea una versión), **D-10** (rangos encimados se rechazan),
**D-36** (mínimo de datos para publicar un agregado) y RN-01 / RN-02 (el ingreso es de la
**zona agregada**, nunca de una persona).

## Qué recibe de catalog-service (D-35)

| Antes (catalog-service) | Ahora (este servicio) |
|---|---|
| `GET/POST/PATCH/DELETE /v1/segments` | Mismas rutas, mismos campos, más `version` y `versionValidFrom` |
| `PUT /v1/zones/:id/classification` | `PUT /v1/zones/:zoneId/classification` (ahora guarda la versión del segmento) |

catalog-service conserva las zonas (identidad), los indicadores y
`GET /v1/zones/compare`. Cuando este servicio esté arriba, catalog retira sus rutas de
segmentos y de clasificación; hasta entonces **no conviven las dos escrituras**: la web y
el escritorio cambian de servicio en el mismo paso.

## Tablas (Postgres compartido; este servicio es el único que las escribe)

| Tabla | Estado | Contenido |
|---|---|---|
| `segmentos_ingreso` | Recibida de catalog | Identidad del segmento (`id`, `codigo`) y sus valores **vigentes**, para que quien ya la lee no cambie. Se agrega `version_actual`. |
| `segmento_versiones` | Nueva | Una fila por versión: rango, nombre, fuente, frecuencia, relación con la zona, limitaciones, desde y hasta cuándo valió, quién la creó y por qué. Solo se anexa. |
| `zona_clasificaciones` | Recibida de catalog | Historial de clasificación de cada zona. Se agrega `segmento_version` (con qué versión se clasificó). |

No usa MongoDB. Redis solo para la sesión (`SessionGuard`).

## Permisos (Matriz §3.2)

| Admin | Analista | Gerente | Resp. precios | Planeador | Auditor | Proveedor | Investigador |
|---|---|---|---|---|---|---|---|
| L | **T** | L | L | L | L | – | – |

Es la misma fila de M05 (Segmentos de ingreso). La clasificación de una zona es parte de
M05 ("Clasificación de zonas por nivel de ingreso"), así que también la escribe el
**Analista comercial**.

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/segments` | Los 6 perfiles internos |
| GET | `/v1/segments/:id` | Los 6 perfiles internos |
| POST | `/v1/segments` | Analista comercial |
| PATCH | `/v1/segments/:id` | Analista comercial |
| DELETE | `/v1/segments/:id` | Analista comercial |
| GET | `/v1/segments/:id/versions` | Los 6 perfiles internos |
| GET | `/v1/segments/:id/versions/:version` | Los 6 perfiles internos |
| GET | `/v1/zone-classifications` | Los 6 perfiles internos |
| GET | `/v1/zones/:zoneId/classification` | Los 6 perfiles internos |
| GET | `/v1/zones/:zoneId/classification/history` | Los 6 perfiles internos |
| PUT | `/v1/zones/:zoneId/classification` | Analista comercial |
| GET | `/v1/publication/zone-segments` | Los 6 perfiles internos |

Proveedor e Investigador de mercado → `403` en todas. `:id` de segmento es entero;
`:zoneId` es UUID; otro valor → `400`.

---

## Segmentos versionados

### Objeto Segment

Siempre muestra la versión **vigente**.

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
  "description": null,
  "version": 2,
  "versionValidFrom": "2026-10-30T16:00:00.000Z"
}
```

- `incomeRangeMin` / `incomeRangeMax` son **cadenas decimales** (`numeric(12,2)`).
  `incomeRangeMax: null` = sin tope superior.
- `code` identifica al segmento entre versiones y **no cambia**.
- En XML los nulos (`incomeRangeMax`, `description`) se omiten.

### Objeto SegmentVersion

```json
{
  "segmentId": 1,
  "version": 1,
  "name": "Ingreso bajo",
  "incomeRangeMin": "0.00",
  "incomeRangeMax": "12000.00",
  "source": "INEGI - ENIGH 2022",
  "updateFrequency": "Anual, al publicarse la ENIGH",
  "zoneRelation": "Se asigna a la ZONA agregada (RN-02).",
  "limitations": "No captura variación de ingreso dentro de la misma zona.",
  "description": null,
  "validFrom": "2026-09-25T19:21:10.262Z",
  "validTo": "2026-10-30T16:00:00.000Z",
  "current": false,
  "createdBy": "uuid-del-usuario",
  "changeReason": null
}
```

`validTo: null` y `current: true` en la versión vigente. `createdBy` es solo el id
(D-26). `changeReason` es `null` en la versión 1.

### GET /v1/segments

Query: `page`, `limit`. Orden fijo: `incomeRangeMin` ascendente.
Response `200`: `{ "data": [Segment], "total": 3, "page": 1, "limit": 20 }`.
XML: `segmentListResponse`.

### GET /v1/segments/:id

Response `200`: Segment (`segmentResponse`). Inexistente → `404`.

### POST /v1/segments

Crea el segmento en su **versión 1**.

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
| `incomeRangeMin` | obligatorio, numérico **≥ 0** (negativo → `400`) |
| `incomeRangeMax` | opcional, numérico positivo; omitir = sin tope. Debe ser **mayor** que `incomeRangeMin` (si no → `400`) |
| `source` | obligatorio: de dónde sale el rango (institución, publicación o enlace) |
| `updateFrequency` | obligatorio, ≤ 60 caracteres |
| `zoneRelation`, `limitations` | obligatorios, texto |
| `description` | opcional |

Campos no listados → `400`. Response `201`: Segment con `version: 1`.
`code` o `name` repetido → `409`.

**Rangos encimados (D-10, D-35) → `400`**, con el código del segmento con el que choca.
Dos rangos se enciman si `a.min ≤ b.max` y `b.min ≤ a.max`, con "sin tope" como infinito.
Solo se compara contra las versiones **vigentes** de los demás segmentos.

> En catalog-service este caso respondía `409`. Aquí es `400` porque así lo fija D-35
> ("rango encimado → 400"). La web y el escritorio deben tratarlo como error de captura.

### PATCH /v1/segments/:id — crea una versión nueva (D-35)

Mismo cuerpo que POST con todos los campos opcionales, **sin `code`** (mandarlo → `400`),
más `changeReason` (opcional, ≤ 300 caracteres: por qué cambió).

- Si algún valor cambia de verdad: la versión vigente se cierra (`validTo` = ahora), se
  anexa la versión `n + 1` con los valores resultantes y el segmento pasa a mostrarla.
  Response `200`: Segment con la versión nueva.
- Si el cuerpo no cambia ningún valor: **no se crea versión**; responde `200` con el
  Segment tal como estaba.
- Las versiones anteriores **no se modifican ni se borran**, y las clasificaciones de zona
  ya hechas conservan la versión con la que se hicieron.

Inexistente → `404`; `name` ya usado por otro → `409`; rango inválido o encimado → `400`.

### DELETE /v1/segments/:id

Response `204` sin cuerpo y se borran sus versiones. Inexistente → `404`. Si alguna zona
está o **estuvo** clasificada con el segmento → `409`: el historial no se pierde.

### GET /v1/segments/:id/versions

Paginado, la más reciente primero. Response `200`:
`{ "data": [SegmentVersion], "total": 2, "page": 1, "limit": 20 }`.
XML: `segmentVersionListResponse`. Segmento inexistente → `404`.

### GET /v1/segments/:id/versions/:version

Response `200`: SegmentVersion (`segmentVersionResponse`). Segmento o versión inexistente
→ `404`; `:version` no entero positivo → `400`.

---

## Clasificación de zonas

Una zona tiene **una** clasificación vigente y un historial. Cada clasificación guarda el
segmento **y la versión** con la que se hizo (D-35): un análisis de un periodo pasado usa
la clasificación que valía entonces, no la de hoy.

### Objeto ZoneClassification

```json
{
  "id": "uuid",
  "zoneId": "97925ca4-3845-4e68-9660-46f781957b8c",
  "segmentId": 3,
  "segmentCode": "ING_3",
  "segmentName": "Ingreso alto",
  "segmentVersion": 1,
  "segmentCurrentVersion": 2,
  "origin": "manual",
  "validFrom": "2026-09-25",
  "validTo": null,
  "current": true,
  "assignedBy": "uuid-del-usuario"
}
```

- `segmentName` es el nombre **en la versión con la que se clasificó**.
- `segmentVersion` ≠ `segmentCurrentVersion` indica que el segmento cambió después de
  clasificar la zona; la clasificación no se mueve sola.
- `origin`: `manual` | `cluster`. Las clasificaciones por cluster que ya existan se leen;
  este servicio solo **crea** manuales.
- `validFrom` / `validTo` son fechas (`YYYY-MM-DD`). `assignedBy` puede ser `null` en
  registros sembrados.
- En las clasificaciones anteriores al Sprint 4 `segmentVersion` es `1`.

### GET /v1/zone-classifications

Paginado. Query (todos opcionales y combinables):

| Parámetro | Regla |
|---|---|
| `zoneId` | UUID |
| `segmentId` | entero ≥ 1 |
| `current` | `true` = solo las vigentes; `false` = solo las cerradas |
| `asOf` | `YYYY-MM-DD`: las que valían ese día (`validFrom ≤ asOf` y sin cerrar, o `validTo > asOf`). No se combina con `current` (→ `400`) |

Orden: `validFrom` descendente. Response `200`:
`{ "data": [ZoneClassification], "total": n, "page": 1, "limit": 20 }`.
XML: `zoneClassificationListResponse`.

### GET /v1/zones/:zoneId/classification

Response `200`: la ZoneClassification vigente (`zoneClassificationResponse`). Zona sin
clasificación vigente → `404`.

### GET /v1/zones/:zoneId/classification/history

Paginado, la más reciente primero. Zona sin ninguna clasificación → `200` con `data: []`.

### PUT /v1/zones/:zoneId/classification

Body: `{ "segmentId": 2 }` (campos extra → `400`).

1. Valida la zona con `GET {CATALOG_SERVICE_URL}/v1/zones/:zoneId` (reenvía el
   `Authorization` y el `X-Correlation-Id`). Inexistente → `404`. catalog-service sin
   responder en 3 s → `503`.
2. Segmento inexistente → `400`.
3. Si la zona ya está clasificada en ese segmento **y en su versión vigente**: no cambia
   nada y responde `200` con la clasificación actual.
4. Si no: en **una transacción** cierra la vigente (`validTo` = hoy) y crea la nueva con
   `segmentVersion` = versión vigente del segmento y `assignedBy` = quien llama.

Response `200`: ZoneClassification nueva. Para adoptar una versión nueva del segmento se
vuelve a llamar con el mismo `segmentId`.

---

## Publicación de agregados (D-36)

### GET /v1/publication/zone-segments

Dice, para cada zona con clasificación vigente, si su combinación **zona-segmento** tiene
datos suficientes para publicar un agregado, y publica el ticket promedio solo cuando sí.
**No se pagina** (una fila por zona clasificada; excepción de `paginacion.md`: agregado
acotado).

Query: `dateFrom`, `dateTo` (`YYYY-MM-DD`, opcionales; `dateFrom > dateTo` → `400`),
`zoneId` (UUID, opcional).

```json
{
  "minTransactions": 10,
  "minStores": 3,
  "rule": "ambos",
  "data": [
    {
      "zoneId": "97925ca4-…", "segmentId": 3, "segmentCode": "ING_3", "segmentVersion": 1,
      "transactions": 42, "stores": 3,
      "disponible": true, "motivo": null, "averageTicket": 86.4
    },
    {
      "zoneId": "f2670df2-…", "segmentId": 2, "segmentCode": "ING_2", "segmentVersion": 2,
      "transactions": 9, "stores": 2,
      "disponible": false,
      "motivo": "Menos de 10 transacciones y menos de 3 tiendas en la combinación zona-segmento (D-36).",
      "averageTicket": null
    }
  ]
}
```

- `transactions`: transacciones de la zona en el periodo. `stores`: tiendas de la zona
  **con al menos una transacción** en el periodo. Ambos se piden a core-process-service y
  catalog-service **por HTTP** (`CORE_PROCESS_SERVICE_URL`, `CATALOG_SERVICE_URL`),
  reenviando el `Authorization` y el `X-Correlation-Id`. Si alguno no responde en 3 s →
  `503`.
- Cuando `disponible` es `false`, `averageTicket` es `null` (se omite en XML): **nunca
  sale un número**, ni `0`.
- Nunca se guarda ni se devuelve dato alguno de una persona o de una compra individual.

**Cómo se combinan los dos umbrales — P-11 sigue PENDIENTE.** D-36 dice "menos de 10
transacciones (o 3 tiendas)" y no fija si hacen falta las dos condiciones o basta una.
Mientras el Product Owner no lo decida:

| Caso | Resultado |
|---|---|
| ≥ 10 transacciones **y** ≥ 3 tiendas | `disponible: true` (vale con cualquiera de las dos lecturas) |
| < 10 transacciones **y** < 3 tiendas | `disponible: false` (caso de control de D-36) |
| Solo se cumple una | Lo decide la variable `PUBLICATION_RULE`: `ambos` (por defecto, no publica) o `cualquiera` (publica) |

El valor por defecto es el que **no** publica, porque el riesgo de D-36 es describir a una
sola tienda. El campo `rule` de la respuesta dice con cuál se calculó. Cuando se cierre
P-11 se cambia la variable, no el código.

Casos de control (prueba unitaria):

| Transacciones | Tiendas | `ambos` | `cualquiera` |
|---|---|---|---|
| 10 | 3 | disponible | disponible |
| 9 | 2 | no disponible | no disponible |
| 10 | 2 | no disponible | disponible |
| 9 | 3 | no disponible | disponible |

---

## Auditoría

Se reporta a audit-service (`POST /v1/auditoria`, `servicio: income-segmentation-service`)
**después** de que la operación tuvo éxito y sin bloquearla (timeout de 1.5 s): alta
(`insert`), versión nueva (`update`, con `cambios: [{ campo, previo, posterior }]` y la
versión) y baja (`delete`) sobre `segmentos_ingreso`; y la clasificación de una zona
(`update` sobre `zona_clasificaciones`). Variable: `AUDIT_SERVICE_URL`.

No emite notificaciones: ninguna decisión define un aviso para estos eventos.

## Códigos de error

| Status | Cuándo |
|---|---|
| 400 | Cuerpo o query inválidos, campo desconocido, `code` en el PATCH, rango inválido o **encimado**, `:id` no numérico, `:zoneId` no UUID, segmento inexistente al clasificar |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso sobre la ruta |
| 404 | Segmento, versión o zona inexistente; zona sin clasificación vigente |
| 409 | `code`/`name` duplicado; borrar un segmento con historial de clasificaciones |
| 503 | catalog-service o core-process-service no responden; Redis sin responder al validar la sesión |

## Consecuencias para otros servicios y clientes (D-35)

No son parte de este contrato; las coordina cada dueño:

- **web** (`web/src/api/segmentos.ts`) y **escritorio** (`desktop/src/api/segmentsApi.ts`):
  cambian la base de `:3102` a `:3112`. Las rutas y los campos de segmentos son los mismos.
- **decision-service** lee por SQL `segmentos_ingreso` (accesibilidad) y
  `zona_clasificaciones` (simulación); **algorithms-core** y **core-process-service**
  también leen la clasificación vigente. Las columnas que usan no cambian, así que siguen
  funcionando; deben pasar a consultar este servicio por HTTP.
- **catalog-service** retira `/v1/segments` y `PUT /v1/zones/:id/classification`, y su
  `GET /v1/zones/compare` deja de leer `zona_clasificaciones` por SQL.

## Por confirmar con el Product Owner

1. **P-11** (arriba): regla para combinar los dos umbrales de D-36.
2. La clasificación de una zona pasa del Administrador (como estaba en catalog-service) al
   **Analista comercial**, por ser parte de M05. Si debe seguir siendo del Administrador,
   cambia solo la fila de permisos.
