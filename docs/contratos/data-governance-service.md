# Contrato: data-governance-service (T-06 · T-14 · Sprint 4)

Base: `http://data-governance-service:3119` · Todas las rutas cuelgan de `/v1/` y son
**nuevas** (el servicio no existía). Responde JSON por defecto y XML si
`Accept: application/xml` (XSD en `data-governance-service.xsd`, namespace
`governance/v1`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}`. Listados paginados según
`paginacion.md`. Todas las rutas (menos `GET /v1/health`) requieren
`Authorization: Bearer <accessToken>` y sesión activa en Redis (`sesion_actual`).

Plantilla: `services/template-fastapi/` (con T-02: `X-Correlation-Id` y health con
dependencias). `GET /v1/health` sigue `health.xsd` y revisa `postgres` y `redis`
(`mongodb`: `no configurado`). Rutas y campos en **inglés**; los textos para el usuario
(`motivo`, `ownerAction`) en español.

Decisiones que aplica: **D-43** (retención, calidad y linaje), **D-47** (Postgres para
datos de negocio), **D-25** (almacén caído = 503), **D-26** (solo `userId`) y **D-20** (un
indicador que no se puede calcular sale `disponible: false` con motivo, **nunca 0**).

Ejemplos ejecutables (JSON y XML validado contra el XSD) en `docs/contratos/ejemplos/`,
con el prefijo `data-governance-`.

## Qué hace y qué no hace

| Hace | No hace |
|---|---|
| Registra **fuentes** de datos y sus **versiones** | Leer tablas de otros servicios |
| Guarda el **linaje** de cada importación, versión de segmento y corrida, y responde "¿de dónde salió este resultado?" | Borrar o archivar datos de otros: **el servicio dueño aplica la retención sobre su almacén** (guía del Parcial 3) |
| Publica las **políticas de retención** de D-43, evalúa qué vencería en una fecha y simula el vencimiento con datos sintéticos | Cambiar los plazos de D-43 (eso pide una decisión nueva) |
| Mide la **calidad** por fuente: completitud, duplicados, fuera de rango y frescura | Corregir datos |

## Tablas (Postgres compartido; este servicio es el único que las escribe)

Migración propia: `db/migraciones/sprint4_data_governance.sql` (se entrega con T-14;
Juan Ángel la integra a `db/schema.sql`).

| Tabla | Contenido |
|---|---|
| `fuentes_datos` | Una fila por fuente: `clave` única, nombre, tipo, servicio dueño, descripción, `activa`, quién y cuándo. La migración siembra las 6 de abajo. Nunca se borra; se desactiva. |
| `fuente_versiones` | Versiones de cada fuente. Solo se anexa. Única por (`fuente`, `version`). |
| `linaje_registros` | Un registro por recurso producido: servicio, tipo y id del recurso, fuente y versión, quién (`usuario_id`), cuándo y el `X-Correlation-Id`. Único por (`servicio`, `tipo_recurso`, `recurso_id`). Solo se anexa. |
| `linaje_insumos` | De qué otros recursos salió cada registro (servicio, tipo e id). |
| `politicas_retencion` | Las 6 políticas de D-43, sembradas por la migración. Solo lectura. |

No usa MongoDB. Redis solo para la sesión.

**Fuentes sembradas:**

| `key` | Nombre | `type` | Servicio dueño |
|---|---|---|---|
| `ventas-archivo` | Importación de ventas por archivo (CSV, JSON, XML) | `importacion` | transactions-ingestion-service |
| `ventas-core-process` | Transacciones confirmadas y canastas | `operacion` | core-process-service |
| `capturas-campo` | Capturas de campo: disponibilidad, precio observado y visitas | `captura` | availability-service |
| `inegi-enigh` | INEGI ENIGH: ingreso corriente trimestral por hogar | `referencia_externa` | income-segmentation-service |
| `generador-sintetico` | Generador de datos del Parcial 3 (con semilla) | `sintetico` | data-governance-service |
| `seed-demo` | Datos de prueba del repositorio (`data_retail.sql` y CSV de 100 canastas) | `sintetico` | data-governance-service |

## Permisos (Matriz §3.2)

| Admin | Analista | Gerente | Resp. precios | Planeador | Auditor | Proveedor | Investigador |
|---|---|---|---|---|---|---|---|
| **T** | L | L | L | L | L | – | – |

El Administrador da de alta y edita fuentes y versiones. Los demás perfiles internos
leen, **restringido por recurso**:

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/sources`, `/v1/sources/:key`, `/v1/sources/:key/versions` | Los 6 perfiles internos |
| POST | `/v1/sources` | Administrador |
| PATCH | `/v1/sources/:key` | Administrador |
| POST | `/v1/sources/:key/versions` | Administrador |
| POST | `/v1/lineage` | Analista comercial, Responsable de precios, Planeador (los servicios lo llaman con el token de quien hizo la operación; ver DG-3) |
| GET | `/v1/lineage`, `/v1/lineage/:id`, `/v1/lineage/:id/origin` | Administrador y Auditor: todo. Analista, Gerente, Resp. precios y Planeador: **solo lo propio** (DG-6) |
| GET | `/v1/quality-report` | Administrador, Auditor, Analista comercial |
| GET | `/v1/retention-policies` | Administrador, Auditor |
| GET | `/v1/retention/evaluation` | Administrador, Auditor |
| POST | `/v1/retention/simulate` | Administrador, Auditor |

Proveedor e Investigador de mercado → `403` en todas. Un rol fuera de la lista de la ruta
→ `403`. Un registro de linaje ajeno para quien solo ve lo propio → **`404`**, el mismo
cuerpo que uno inexistente (Matriz §2).

---

## Reglas del dominio

Decididas por el dueño del dominio (guía del Parcial 3), dentro de D-43 y D-47.

| ID | Regla |
|---|---|
| **DG-1** | **Fuentes.** Se identifican por `key` (minúsculas, números y guiones, 3 a 40 caracteres), que no cambia. Una fuente nunca se borra: `PATCH` con `active: false` la desactiva. Registrar linaje contra una fuente inactiva o inexistente → `400`. |
| **DG-2** | **Versiones.** Solo se anexan; (`key`, `version`) es único. Las crea el Administrador (`origin: manual`) o se crean solas cuando un registro de linaje usa una versión nueva de una fuente existente (`origin: linaje`). `currentVersion` de la fuente es la más reciente. |
| **DG-3** | **Linaje idempotente.** La llave es `service` + `resourceType` + `resourceId`. Primera vez → `201`. Mismo cuerpo otra vez → `200` con el registro existente (reintentar es seguro). Mismo recurso con **otro** contenido → `409`: el linaje no se sobrescribe. `userId` sale del token y `correlationId` del encabezado `X-Correlation-Id`; el cuerpo no los trae. |
| **DG-4** | **Id del recurso** según su tipo: `importacion` = id del lote (UUID de ingestion); `version_segmento` = `"{segmentId}:{version}"` (p. ej. `"2:3"`); `corrida` = id de la corrida en su servicio (ObjectId de Mongo o UUID). |
| **DG-5** | **Origen.** `GET /v1/lineage/:id/origin` recorre `inputs` hacia atrás hasta **5 niveles** (`truncated: true` si hay más). Un ciclo se corta. Un insumo sin linaje registrado sale con `registered: false`, sin inventarle fuente. |
| **DG-6** | **Solo lo propio.** Para Analista, Gerente, Responsable de precios y Planeador, el listado filtra `userId` = quien consulta y un registro ajeno es `404`. En el árbol de origen, un insumo ajeno sale con `restricted: true` y solo su `reference` (servicio, tipo e id), sin quién ni cuándo. |
| **DG-7** | **Calidad.** Cuatro métricas por fuente (tabla de abajo), cada una con numerador y denominador. Si una métrica no se puede medir con lo que expone el dueño, sale `disponible: false` con motivo y sin valor: **nunca 0** (D-20). Un servicio que no responde afecta solo a su fuente, no al reporte completo. |
| **DG-8** | **Frescura.** Ventas: días desde el último lote confirmado; vencida (`stale: true`) con **más de 7 días**, el mismo plazo de D-38. Capturas: proporción de existencias **vigentes** (`status` distinto de `vencido` en availability, D-38). Segmentos: días desde la versión vigente más vieja; vencida con más de **365 días**, porque su frecuencia de actualización declarada es anual. **Decidido en este dominio** (ninguna decisión fijaba estos umbrales): se toman los plazos que el propio sistema ya declara (D-38 para datos de campo y la frecuencia "anual" de los segmentos), en lugar de inventar uno nuevo. Frontera: último lote hace 7 días → vigente; hace 8 → `stale: true`. Variables `FRESHNESS_SALES_DAYS` y `FRESHNESS_SEGMENTS_DAYS` para cambiarlos sin tocar código. |
| **DG-9** | **Vencimiento.** `expiresOn = fecha del dato + plazo` (calendario: un 29 de febrero más años cae el 1 de marzo). Un dato está **vencido si `expiresOn ≤ asOf`**: vence el mismo día en que se cumple el plazo. La bitácora no vence nunca. |
| **DG-10** | **Evaluación.** Para cada conjunto se pide al dueño **cuántos** datos vencerían en `asOf`. Si el dueño no expone ese conteo, sale `disponible: false` con motivo, nunca 0. Un `asOf` futuro **simula** el vencimiento sobre los datos reales sin tocar nada. |
| **DG-11** | **Simulación.** `POST /v1/retention/simulate` aplica DG-9 a registros sintéticos del cuerpo (máximo 1 000). No lee ni escribe nada: demuestra la regla con datos de prueba. |

### Métricas de calidad (DG-7)

| Métrica | `ventas-archivo` (lotes de ingestion en la ventana, sin los descartados) | `capturas-campo` (availability) | `inegi-enigh` (income-segmentation) |
|---|---|---|---|
| `completeness` | 1 − filas rechazadas por **campo vacío** (códigos que terminan en `_VACIO`/`_VACIA`) / filas | No disponible: availability rechaza una captura incompleta antes de guardarla | — |
| `duplicates` | (`repeated` + `conflicts`) / filas (D-34) | Capturas en `conflicto` / capturas (D-42) | — |
| `outOfRange` | Filas rechazadas por **valor inválido o fuera del dominio** (los demás códigos: `*_INVALIDO`, `FECHA_FUTURA`, `VALOR_DEMASIADO_LARGO`, `*_NO_EXISTE`, `*_INACTIVA`…) / filas | No disponible: availability rechaza existencias negativas o fechas futuras | — |
| `freshness` | Días desde el último lote confirmado (DG-8) | Existencias vigentes / existencias (DG-8) | Días desde la versión vigente más vieja (DG-8) |

`rejectedByCode` lista los rechazos de la ventana por código, para que el conteo se
pueda revisar. Un código que no cae en ninguna regla cuenta en `outOfRange` y aparece ahí.

---

## Fuentes y versiones

### Objeto Source

```json
{ "key": "inegi-enigh", "name": "INEGI ENIGH: ingreso corriente trimestral por hogar",
  "type": "referencia_externa", "ownerService": "income-segmentation-service",
  "description": null, "active": true, "currentVersion": "ENIGH 2022",
  "createdAt": "2026-11-26T09:00:00.000000+00:00", "createdBy": null }
```

`type`: `importacion` | `operacion` | `captura` | `referencia_externa` | `sintetico`.
`createdBy` es `null` en las sembradas. En XML los nulos se omiten.

### GET /v1/sources

Query: `type`, `ownerService`, `active` (`true`/`false`), `page`, `limit`. Orden: `key`.
Response `200` (`sourceListResponse`), `ejemplos/data-governance-sources.json`.

### GET /v1/sources/:key

Response `200` (`sourceResponse`). Inexistente → `404`.

### POST /v1/sources (Administrador)

```json
{ "key": "precios-competencia", "name": "Precios publicados por la competencia",
  "type": "referencia_externa", "ownerService": "pricing-service", "description": "Opcional" }
```

`key` con el formato de DG-1 y única (`409` si existe); `name` ≤ 120; `type` del catálogo;
`ownerService` uno de los 20 servicios de `CONTRIBUTING.md`. Campos extra → `400`.
Response `201` (`sourceResponse`).

### PATCH /v1/sources/:key (Administrador)

`name`, `description`, `ownerService` o `active`. `key` y `type` no cambian (`400`).
Response `200`.

### GET /v1/sources/:key/versions · POST /v1/sources/:key/versions (Administrador)

Listado paginado, la más reciente primero (`sourceVersionListResponse`). Alta:
`{ "version": "ENIGH 2024", "description": "Publicada en julio de 2025" }` → `201`
(`sourceVersionResponse`, `origin: manual`); versión repetida → `409`.

---

## Linaje

### POST /v1/lineage — registro idempotente (DG-3)

Lo llaman los servicios **después** de que su operación tuvo éxito, sin bloquearla
(fire-and-forget, 1.5 s), con el token del usuario y su `X-Correlation-Id`. Cuerpo
(`ejemplos/data-governance-lineage-request.json`):

```json
{
  "service": "demand-forecast-service",
  "resourceType": "corrida",
  "resourceId": "674a1f3c9e2b4d0012ab34cd",
  "description": "Pronóstico semanal de Leche entera en Zona Centro",
  "source": { "key": "ventas-core-process",
              "version": "be303c96b5d5e8779e0b1523319e456ef247713341192eedbc6af536c56876ad" },
  "inputs": [ { "service": "transactions-ingestion-service", "resourceType": "importacion",
                "resourceId": "05dbdf5a-8342-4d61-bfce-e04e2b644f9b" } ],
  "occurredAt": "2026-11-25T18:04:12.317000+00:00"
}
```

| Campo | Regla |
|---|---|
| `service` | obligatorio, uno de los 20 servicios |
| `resourceType` | obligatorio: `importacion`, `version_segmento` o `corrida` (D-43) |
| `resourceId` | obligatorio, ≤ 100, con el formato de DG-4 |
| `description` | opcional, ≤ 300 |
| `source.key` | obligatorio, fuente existente y activa (DG-1) |
| `source.version` | obligatorio, ≤ 100. Si no existe, se crea (DG-2) |
| `inputs` | opcional, hasta 50 referencias `{ service, resourceType, resourceId }` sin repetir |
| `occurredAt` | obligatorio, ISO 8601: cuándo se produjo el recurso |

Response `201` la primera vez y `200` si ya existía igual (`lineageRecordResponse`,
`ejemplos/data-governance-lineage.json`): el cuerpo más `id`, `userId`, `correlationId` y
`registeredAt`. Mismo recurso con otro contenido → `409`
(`ejemplos/data-governance-error-409.json`).

### GET /v1/lineage

Query: `service`, `resourceType`, `resourceId`, `sourceKey`, `page`, `limit`. Orden: más
reciente primero. Response `200` (`lineageListResponse`). Con DG-6, solo los registros
propios para los roles que ven lo propio.

### GET /v1/lineage/:id

Response `200` (`lineageRecordResponse`). Inexistente o ajeno (DG-6) → `404`.

### GET /v1/lineage/:id/origin — "¿de dónde salió este resultado?"

Árbol hacia atrás (DG-5), `ejemplos/data-governance-lineage-origin.json`. Es el caso de
control de D-43: una corrida de pronóstico salió de las ventas confirmadas, que salieron
de un lote importado, con fuente, versión, quién y cuándo en cada nivel.

```json
{ "depth": 2, "truncated": false,
  "root": {
    "reference": { "service": "demand-forecast-service", "resourceType": "corrida", "resourceId": "674a…34cd" },
    "registered": true, "restricted": false,
    "record": { "id": "b8e2…", "userId": "5b1e…", "correlationId": "7f3c…", "occurredAt": "…", "…": "…" },
    "source": { "key": "ventas-core-process", "name": "Transacciones confirmadas y canastas",
                "type": "operacion", "ownerService": "core-process-service" },
    "sourceVersion": { "version": "be303c96…", "createdAt": "…", "origin": "linaje" },
    "inputs": [ { "reference": { "service": "transactions-ingestion-service",
                                 "resourceType": "importacion", "resourceId": "05db…" },
                  "registered": true, "restricted": false,
                  "record": { "description": "Lote ventas-oct.csv (154 filas)", "…": "…" },
                  "source": { "key": "ventas-archivo", "…": "…" },
                  "sourceVersion": { "version": "e3f81957…", "…": "…" },
                  "inputs": [] } ] } }
```

Inexistente o ajeno → `404`.

### Cómo registrar linaje (para Juan Ángel y Pamela)

Qué registra cada servicio, siempre después de que su operación tuvo éxito:

| Servicio | Cuándo | `resourceType` / `resourceId` | `source` |
|---|---|---|---|
| transactions-ingestion-service (Juan Ángel) | Al confirmar un lote | `importacion` / id del lote | `ventas-archivo`, versión = SHA-256 del archivo |
| income-segmentation-service (Pamela) | Al crear un segmento o una versión nueva | `version_segmento` / `"{segmentId}:{version}"` | `inegi-enigh`, versión = el campo `source` de esa versión |
| algorithms-core, analytics-stats, demand-forecast-service (Leonardo) | Al guardar una corrida | `corrida` / id de la corrida | `ventas-core-process`, versión = SHA-256 de la foto de datos (D-15) |

Ejemplo ejecutable (con el token de un Analista y el servicio arriba):

```bash
curl -i -X POST http://localhost:3119/v1/lineage \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "X-Correlation-Id: 7f3c9a2e-41d8-4b6f-9e0a-2c5d8b1f4a63" \
  --data @docs/contratos/ejemplos/data-governance-lineage-request.json
# 201 la primera vez; el mismo comando otra vez → 200 con el mismo registro.
```

Reintentar es seguro (DG-3), así que un fallo de red se puede reintentar sin miedo a
duplicar. Si data-governance-service no responde, la operación original igual se
completa y queda una línea de log con el recurso para reintentar.

---

## Calidad

### GET /v1/quality-report

Query: `dateFrom`, `dateTo` (`YYYY-MM-DD`, opcionales; `dateFrom > dateTo` → `400`) y
`sourceKey` (opcional; una sola fuente). Calcula al momento con lo que exponen los dueños
(no guarda el reporte). Response `200` (`qualityReportResponse`),
`ejemplos/data-governance-quality-report.json` (resumido):

```json
{ "dateFrom": "2026-11-01", "dateTo": "2026-11-25", "measuredAt": "2026-11-26T09:15:00.000000+00:00",
  "sources": [
    { "sourceKey": "ventas-archivo", "ownerService": "transactions-ingestion-service", "sampleSize": 254,
      "metrics": [
        { "metric": "completeness", "value": 0.9960629921259843, "unit": "proporcion",
          "numerator": 253, "denominator": 254, "disponible": true },
        { "metric": "duplicates", "value": 0.015748031496062992, "unit": "proporcion",
          "numerator": 4, "denominator": 254, "disponible": true },
        { "metric": "outOfRange", "value": 0.015748031496062992, "unit": "proporcion",
          "numerator": 4, "denominator": 254, "disponible": true },
        { "metric": "freshness", "value": 2.0, "unit": "dias", "disponible": true, "stale": false } ],
      "rejectedByCode": [ { "code": "CANTIDAD_INVALIDA", "count": 1 }, { "code": "FECHA_VACIA", "count": 1 }, "…" ] },
    { "sourceKey": "capturas-campo", "metrics": [
        { "metric": "completeness", "disponible": false,
          "motivo": "availability-service rechaza una captura incompleta antes de guardarla: no hay incompletas que medir." },
        "…" ] } ] }
```

`sampleSize`: filas (ventas), capturas (campo) o segmentos (ENIGH) que se midieron.

---

## Retención

### GET /v1/retention-policies

Las políticas de D-43, de solo lectura (`retentionPolicyListResponse`,
`ejemplos/data-governance-retention-policies.json`):

| `dataset` | Dueño | `retentionPeriod` | Se cuenta desde | Qué hace el dueño |
|---|---|---|---|---|
| `transacciones` | core-process-service | `P3Y` | fecha de la venta | Decide cómo aplicarla sobre su almacén |
| `capturas_disponibilidad` | availability-service | `P1Y` | `capturedAt` | Ídem |
| `observaciones_precio` | pricing-service | `P1Y` | fecha de la observación | Ídem |
| `visitas_campo` | catalog-service | `P1Y` | fecha de la visita | Ídem |
| `notificaciones` | notifications-service | `P90D` | `createdAt` | **Ya implementado:** archiva lo mayor a 90 días y nunca borra |
| `bitacora` | audit-service | — (se omite) | — | Sin borrado: inmutable |

Las "capturas de campo" de D-43 son tres conjuntos porque tienen tres dueños (D-30, D-38,
D-16).

### GET /v1/retention/evaluation

Query: `asOf` (`YYYY-MM-DD`, opcional; default hoy). Para cada conjunto, `cutoffDate` =
`asOf − plazo` y `expiredCount` = datos con fecha **≤ `cutoffDate`** (DG-9), pedidos al
dueño (DG-10). Response `200` (`retentionEvaluationResponse`),
`ejemplos/data-governance-retention-evaluation.json`:

```json
{ "asOf": "2029-09-01",
  "data": [
    { "dataset": "transacciones", "ownerService": "core-process-service", "retentionPeriod": "P3Y",
      "cutoffDate": "2026-09-01", "expiredCount": 56, "disponible": true },
    { "dataset": "capturas_disponibilidad", "retentionPeriod": "P1Y", "cutoffDate": "2028-09-01",
      "disponible": false, "motivo": "availability-service no filtra capturas por fecha todavía (pedido en el contrato)." },
    { "dataset": "bitacora", "disponible": true, "motivo": "Sin borrado: nunca vence (D-43)." } ] }
```

El conteo de transacciones es **real**: con el CSV de 100 canastas cargado (agosto y
septiembre de 2026), en `asOf = 2029-09-01` vencerían 56: las 54 de agosto y las 2 del
1 de septiembre, que caen justo en el día de corte (DG-9).

### POST /v1/retention/simulate

Demuestra DG-9 con datos sintéticos (DG-11). Cuerpo
(`ejemplos/data-governance-retention-simulation-request.json`):
`{ "asOf": "2026-11-25", "records": [ { "dataset": "transacciones", "recordId": "T-SIM-001", "date": "2023-11-25" }, … ] }`.
`records`: 1 a 1 000, `dataset` del catálogo, `recordId` ≤ 60, `date` `YYYY-MM-DD`.

Response `200` (`retentionSimulationResponse`,
`ejemplos/data-governance-retention-simulation.json`):

| Registro | Fecha | Vence | ¿Vencido al 2026-11-25? |
|---|---|---|---|
| Transacción | 2023-11-25 | 2026-11-25 | **Sí** (vence ese mismo día) |
| Transacción | 2023-11-26 | 2026-11-26 | No |
| Transacción | 2024-02-29 | 2027-03-01 | No (29 de febrero + 3 años) |
| Captura de disponibilidad | 2025-11-24 | 2026-11-24 | **Sí** |
| Captura de disponibilidad | 2025-11-26 | 2026-11-26 | No |
| Notificación | 2026-08-27 | 2026-11-25 | **Sí** (90 días) |
| Bitácora | 2019-01-01 | — | No (nunca vence) |

Más `summary`: por conjunto, cuántos registros y cuántos vencidos.

---

## Casos de control (pruebas del servicio)

| Caso | Resultado esperado |
|---|---|
| Linaje: mismo cuerpo dos veces | `201` y luego `200` con el mismo `id` |
| Linaje: mismo recurso con otra versión de fuente | `409` y el registro original intacto |
| Linaje: fuente inactiva o inexistente | `400` |
| Linaje: versión nueva de una fuente existente | Se crea con `origin: linaje` |
| Origen de una corrida que salió de un lote | Árbol de 2 niveles con fuente, versión, quién y cuándo (D-43) |
| Origen con un insumo sin registrar | `registered: false`, sin fuente inventada |
| Origen con más de 5 niveles o con ciclo | `truncated: true`; el ciclo se corta |
| Analista consulta un registro de otro usuario | `404`; en el árbol, `restricted: true` |
| Gerente intenta `POST /v1/lineage` | `403` |
| Calidad: lote con 1 fila con `FECHA_VACIA` y 4 inválidas de 254 | `completeness` 253/254, `outOfRange` 4/254 |
| Calidad: availability no responde | Esa fuente con métricas `disponible: false`; las demás sí salen |
| Frescura de ventas: último lote hace 7 días / hace 8 días | `stale: false` / `stale: true` (DG-8) |
| Frescura de segmentos: versión vigente de hace 365 / 366 días | `stale: false` / `stale: true` (DG-8) |
| Retención: frontera (2023-11-25 al 2026-11-25) | Vencido |
| Retención: 29 de febrero + 3 años | Vence el 1 de marzo |
| Retención: bitácora | Nunca vence |
| Evaluación con el CSV de 100 canastas, `asOf` 2029-09-01 | 56 transacciones vencidas |
| Postgres caído | `503 SERVICE_UNAVAILABLE`; `GET /v1/health` → `200 degraded` |

## Bitácora y avisos

A audit-service (`POST /v1/auditoria`, `servicio: data-governance-service`), después de
que la operación tuvo éxito y sin bloquearla (1.5 s): alta y cambio de fuente (`insert` /
`update` sobre `fuentes_datos`, con `cambios`) y alta de versión manual (`insert` sobre
`fuente_versiones`). El registro de linaje **no** se audita: ya es en sí un registro
inmutable con quién, cuándo y correlación. No emite notificaciones: ninguna decisión
define un aviso para estos eventos.

## Códigos de error

| Status | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo o query inválidos, campo desconocido, `key` mal formada, `service` que no es de los 20, fuente inactiva o inexistente al registrar linaje, cambiar `key` o `type`, `dateFrom > dateTo`, más de 1 000 registros en la simulación |
| 401 | `UNAUTHORIZED` | Sin token, token revocado o sin sesión en Redis |
| 403 | `FORBIDDEN` | Rol sin permiso sobre la ruta |
| 404 | `NOT_FOUND` | Fuente o registro inexistente; registro ajeno para quien ve solo lo propio (DG-6) |
| 409 | `CONFLICT` | `key` o versión repetida; mismo recurso de linaje con otro contenido (DG-3) |
| 503 | `SERVICE_UNAVAILABLE` | Postgres o Redis no responden (D-25). Un servicio dueño caído **no** da 503: solo deja su fuente o conjunto `disponible: false` (DG-7, DG-10) |

---

## Lo que consume

Por **HTTP**, reenviando el `Authorization` del usuario y el `X-Correlation-Id`, con 3 s
de límite. No lee tablas de otros servicios.

| Servicio | Ruta | Estado | Para qué |
|---|---|---|---|
| transactions-ingestion-service | `GET /v1/transaction-imports` | En contrato (T-04) | Lotes de la ventana y sus conteos (calidad de `ventas-archivo`) |
| core-process-service | `GET /v1/transactions?dateTo=&limit=1` | Existe | `total` = transacciones vencidas (evaluación) |
| availability-service | `GET /v1/availability/captures?status=conflicto&limit=1` y sin `status` | Existe | Duplicados de capturas |
| availability-service | `GET /v1/availability/stock?status=vencido&limit=1` y sin `status` | Existe | Frescura de capturas |
| income-segmentation-service | `GET /v1/segments` | Existe | `versionValidFrom` de cada segmento (frescura) |

### Lo que se pide

1. **Juan Ángel (ingestion):**
   - Que el resumen del lote traiga `rejectedByCode` (conteo de filas rechazadas por
     código). Sin él, separar "incompleto" de "fuera de rango" obliga a leer todas las
     filas de cada lote.
   - Que el **Auditor** pueda leer los lotes (Lectura, como en el resto de la Matriz). Hoy
     el contrato de ingestion da 403 a los demás roles, y el reporte de calidad del
     Auditor saldría sin `ventas-archivo`.
   - Registrar linaje al confirmar un lote (tabla de arriba).
2. **Pamela:**
   - `dateFrom`/`dateTo` (por `capturedAt`) en `GET /v1/availability/captures`, para
     medir duplicados en la ventana y contar capturas vencidas. Mientras no exista, las
     métricas de capturas son sobre todo el historial y lo dicen en `motivo`, y su
     evaluación de retención sale no disponible.
   - Registrar linaje al crear una versión de segmento (tabla de arriba).
3. **pricing-service y catalog-service (Pamela):** un conteo por fecha de observaciones de
   precio y de visitas de campo, para evaluar su retención. Mientras no exista, salen no
   disponibles con motivo.

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `PORT` | `3119` | |
| `SERVICE_NAME` | `data-governance-service` | Logs y health |
| `XML_NAMESPACE` | `governance/v1` | Raíz XML |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | — | Postgres (tablas propias) |
| `REDIS_URL`, `JWT_ACCESS_SECRET` | — | Sesión (plantilla) |
| `INGESTION_SERVICE_URL`, `CORE_PROCESS_SERVICE_URL`, `AVAILABILITY_SERVICE_URL`, `INCOME_SEGMENTATION_SERVICE_URL` | — | Calidad y retención |
| `AUDIT_SERVICE_URL` | — | Bitácora |
| `FRESHNESS_SALES_DAYS` | `7` | DG-8 |
| `FRESHNESS_SEGMENTS_DAYS` | `365` | DG-8 |

## Limitaciones conocidas

- El linaje depende de que cada servicio lo registre. Un recurso de un servicio que aún
  no lo hace aparece como `registered: false` en el árbol de quien lo usó.
- La calidad de `capturas-campo` mide solo duplicados y frescura: availability ya no deja
  entrar capturas incompletas ni fuera de rango, así que esas dos no se pueden medir y lo
  dicen.
- La retención se **evalúa y simula** aquí; aplicarla le toca a cada dueño, y salvo
  notifications (que ya archiva) ninguno la aplica todavía.

## Por confirmar

1. **Juan Ángel:** `rejectedByCode` en el lote, Lectura del Auditor sobre los lotes y
   registro de linaje al confirmar.
2. **Pamela:** filtro por fecha en capturas, conteos por fecha en observaciones y visitas,
   y registro de linaje en versiones de segmento.
3. **Juan Ángel (Matriz):** los umbrales de frescura de DG-8 (7 y 365 días) se decidieron
   en este dominio; falta incorporarlos a la Matriz §4.
