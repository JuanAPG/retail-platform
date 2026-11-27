# Contrato: demand-forecast-service (T-06 · T-13 · Sprint 4)

Base: `http://demand-forecast-service:3116` · Todas las rutas cuelgan de `/v1/` y son
**nuevas** (el servicio no existía). Responde JSON por defecto y XML si
`Accept: application/xml` (XSD en `demand-forecast-service.xsd`, namespace `forecast/v1`).
Errores con el cuerpo estándar `{statusCode, message, code, details, path, timestamp}`.
Listados paginados según `paginacion.md`. Todas las rutas (menos `GET /v1/health`)
requieren `Authorization: Bearer <accessToken>` y sesión activa en Redis
(`sesion_actual`).

Plantilla: `services/template-fastapi/` (con T-02: `X-Correlation-Id` y health con
dependencias). `GET /v1/health` sigue `health.xsd` y revisa `mongodb` y `redis`
(`postgres`: `no configurado`). Python + FastAPI + statsmodels. Rutas y campos en
**inglés**, como algorithms-core y analytics-stats; los textos para el usuario
(`motivo`, `limitations`, `assumptions`) en español.

Decisiones que aplica: **D-40** (método, horizonte, intervalos, validación y mínimo de
historia), **D-36** (ningún agregado con pocos datos), **D-47** (corridas en MongoDB),
**D-15** (repetir da lo mismo), **D-25** (almacén caído = 503), **D-26** (solo `userId`),
**D-21** (agrupación semanal) y **D-06** (no se mezclan presentaciones: se convierten a
una sola unidad, DF-2). RN-02: la demanda es de la **zona agregada**, nunca de una persona.

Ejemplos ejecutables (JSON y XML validado contra el XSD) en `docs/contratos/ejemplos/`,
con el prefijo `demand-forecast-`.

## Almacenamiento

| Almacén | Uso |
|---|---|
| MongoDB, colección `forecast_runs` (D-47) | Una corrida por documento: parámetros, la serie semanal usada (la foto de D-15) con su SHA-256, el resultado y `durationMs`. Índices `{ userId: 1, date: -1 }` y `{ "parameters.productId": 1, date: -1 }`. |
| Redis | Solo la sesión (`sesion_actual`). |
| PostgreSQL | No usa. No lee tablas de otros servicios. |

## Permisos (Matriz §3.2)

| Admin | Analista | Gerente | Resp. precios | Planeador | Auditor | Proveedor | Investigador |
|---|---|---|---|---|---|---|---|
| L | **T** | L | L | L | L | – | – |

Igual criterio que D-24 (analytics-stats): lanzar un cálculo es del Analista comercial;
las corridas guardadas las leen los 6 perfiles internos.

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/forecast/run` | Analista comercial |
| POST | `/v1/forecast/runs/:id/replay` | Analista comercial |
| GET | `/v1/forecast/runs` | Los 6 perfiles internos |
| GET | `/v1/forecast/runs/:id` | Los 6 perfiles internos |

Proveedor e Investigador de mercado → `403` en todas. Un rol interno que no es el
Analista → `403` en los dos `POST`.

---

## Reglas del dominio

Decididas por el dueño del dominio (guía del Parcial 3: "el dueño de cada dominio puede
resolver preguntas abiertas con una regla, un ejemplo y una prueba de frontera").
Respetan D-40; las que afecten a otro dominio las incorpora el Product Owner a la Matriz.

| ID | Regla |
|---|---|
| **DF-1** | **Semana** = lunes a domingo en `America/Monterrey` (misma zona que core-process). `weekStart` es el lunes. La semana en curso, incompleta, **no entra**: la última semana posible es la que terminó el domingo anterior a hoy. |
| **DF-2** | **Unidad.** La serie es por **producto** (y zona) en la **unidad base** de su tipo: `cantidad × contenido × factorBase` de la presentación vendida (catalog-service) → `kg`, `l` o `pza`. Así 3 de "500 ml" y 1 de "1 l" en la misma semana suman **2.5 l**. Si las presentaciones vendidas del producto son de **tipos distintos** (p. ej. `pieza` y `masa`) no se pueden sumar → `422`. |
| **DF-3** | **Semanas sin ventas.** La historia va de la primera semana con venta a la última semana completa de la ventana. Una semana sin ventas **en medio** cuenta como **0** y sale con `filled: true`; `dataVersion.zeroWeeks` dice cuántas fueron y `limitations` lo avisa. |
| **DF-4** | **Mínimo de historia (D-40):** menos de **12** semanas → `422` con motivo. Frontera: 11 → `422`; 12 → `201`. |
| **DF-5** | **Modelo:** Holt-Winters aditivo (**ETS A,A,A**: error, tendencia y estacionalidad aditivos) de statsmodels, con **periodo estacional de 4 semanas** (≈ un mes; variable `SEASONAL_PERIOD`). statsmodels exige **dos ciclos completos** para estimar la estacionalidad, así que con el mínimo de D-40 (12 − 4 reservadas = 8 semanas para ajustar) el ciclo máximo es 4. Si las semanas para ajustar son menos de `2 × SEASONAL_PERIOD` → `422` con la limitación explícita. La estacionalidad **anual** (52) necesitaría al menos 108 semanas: queda como limitación. |
| **DF-6** | **Validación (D-40):** se ajusta con las primeras `n − 4` semanas, **sin ver** las 4 reservadas, y se pronostican esas 4. `mape` (en %) se calcula solo sobre las reservadas con venta > 0; las que valen 0 se excluyen y se cuentan en `zeroWeeksExcluded`. Si las 4 son 0 → `mape` nulo con `motivo`. |
| **DF-7** | **Pronóstico (D-40):** se vuelve a ajustar con **toda** la historia y se proyectan **8 semanas** con intervalos de **80 % y 95 %** **analíticos** (fórmula del modelo, no simulación: misma entrada, mismo intervalo). Un límite inferior negativo se recorta a **0** y la semana sale con `clipped: true`. |
| **DF-8** | **Publicación (D-36):** si en la ventana hay **menos de 10 transacciones** con el producto o **menos de 3 tiendas** que lo vendieron (en la zona; sin zona, en total), la corrida sale `disponible: false` con `motivo` y **sin ningún número del agregado** (ni historia, ni validación, ni pronóstico). **P-11, decidido en este dominio:** se publica solo si se cumplen **los dos** umbrales (`PUBLICATION_RULE=ambos`). Motivo: el riesgo de D-36 es describir a una sola tienda, así que se elige la lectura que protege más; además coincide con income-segmentation-service. Frontera: 10 transacciones en 2 tiendas → no disponible; 10 en 3 → disponible. La variable permite cambiar a `cualquiera` sin tocar código. |
| **DF-9** | **Reproducible (D-15):** la corrida guarda la serie semanal exacta que usó, su SHA-256, los parámetros y la versión de statsmodels. `POST /v1/forecast/runs/:id/replay` recalcula desde esa foto y dice si salió idéntico. |

---

## POST /v1/forecast/run

```json
{ "productId": "3f6c2a10-8b4e-4c1d-9a7e-1b2c3d4e5f60",
  "zoneId": "97925ca4-3845-4e68-9660-46f781957b8c",
  "dateFrom": "2026-07-01", "dateTo": "2026-11-22" }
```

| Campo | Regla |
|---|---|
| `productId` | obligatorio, UUID |
| `zoneId` | opcional, UUID. Sin zona = demanda de **todas** las zonas sumada |
| `dateFrom`, `dateTo` | opcionales, `YYYY-MM-DD`; `dateFrom > dateTo` → `400`. Se ajustan a semanas completas: `dateFrom` avanza al lunes siguiente si no es lunes y `dateTo` retrocede al domingo anterior si no es domingo (y nunca pasa de la última semana completa, DF-1). Lo que se usó sale en `dataVersion.effectiveFrom` / `effectiveTo` |

Horizonte (8), semanas reservadas (4), intervalos (80 y 95) y modelo **no** se piden: los
fija D-40. Campos no listados → `400`.

**Orden de la corrida:**

1. Cuerpo inválido → `400`.
2. Producto (`GET /v1/products/:id`) y zona (`GET /v1/zones/:id`) en catalog-service.
   Inexistente → `404`.
3. Presentaciones del producto (`contenido`, `unidadMedida.tipo`, `factorBase`). Tipos
   distintos → `422` (DF-2).
4. Ventas semanales por presentación de core-process (ver *Lo que consume*), convertidas
   a la unidad base y sumadas por semana.
5. D-36 (DF-8). No se cumple → la corrida se guarda con `disponible: false` y responde
   `201` sin números del agregado.
6. Menos de 12 semanas → `422` (DF-4). Menos de `2 × SEASONAL_PERIOD` semanas para ajustar
   → `422` (DF-5). Estas corridas **no** se guardan.
7. Validación (DF-6), pronóstico (DF-7), se guarda en `forecast_runs` y responde `201`.
   MongoDB sin responder en 2 s → `503` y la corrida **no** se devuelve sin guardar (D-25).

Response `201` (`forecastRunResponse`). Ejemplo completo y real (generado con el modelo,
20 semanas, una semana rellenada con 0) en `ejemplos/demand-forecast-run.json`; resumido:

```json
{
  "id": "674a1f3c9e2b4d0012ab34cd",
  "type": "forecast",
  "userId": "5b1e7d3c-2a4f-4e6b-8c9d-0e1f2a3b4c5d",
  "date": "2026-11-25T18:04:12.317000+00:00",
  "durationMs": 127.4,
  "parameters": { "productId": "3f6c…", "zoneId": "9792…", "dateFrom": null, "dateTo": null,
                  "horizonWeeks": 8, "holdoutWeeks": 4, "seasonalPeriod": 4,
                  "intervalLevels": [80, 95], "model": "ETS(A,A,A)",
                  "publicationRule": "ambos", "minTransactions": 10, "minStores": 3 },
  "product": { "id": "3f6c…", "name": "Leche entera", "unit": "l", "unitType": "volumen" },
  "zone": { "id": "9792…", "name": "Zona Centro" },
  "disponible": true,
  "motivo": null,
  "coverage": { "transactions": 1184, "stores": 4 },
  "dataVersion": { "sha256": "be303c96…", "source": "core-process-service",
                   "asOf": "2026-11-25T18:04:11.902000+00:00", "weeks": 20,
                   "effectiveFrom": "2026-07-06", "effectiveTo": "2026-11-22", "zeroWeeks": 1 },
  "history": [ { "weekStart": "2026-07-06", "quantity": 192.0, "filled": false }, "…" ],
  "validation": { "trainWeeks": 16, "holdoutWeeks": 4, "mape": 9.880783430220134,
                  "mapeWeeks": 4, "zeroWeeksExcluded": 0, "motivo": null,
                  "holdout": [ { "weekStart": "2026-10-26", "actual": 212.0, "forecast": 203.7501270852417 }, "…" ] },
  "forecast": [ { "weekStart": "2026-11-23", "quantity": 218.82365533914714,
                  "lower80": 169.57322480441806, "upper80": 268.0740858738762,
                  "lower95": 143.5016217461092, "upper95": 294.14568893218507, "clipped": false }, "…" ],
  "model": { "library": "statsmodels 0.14.6", "smoothingLevel": 0.0001,
             "smoothingTrend": 1e-08, "smoothingSeasonal": 9.999000000000001e-05,
             "aic": 222.71140552666856 },
  "excludedPresentations": [ { "presentationId": "c7d8…",
      "reason": "Presentación inactiva sin contenido conocido: sus ventas no se convierten a l." } ],
  "limitations": [ "Estacionalidad de 4 semanas (≈ un mes). La anual necesitaría al menos 108 semanas de historia.",
                   "Una semana sin ventas cuenta como 0 (1 semana rellenada)." ],
  "assumptions": [ "Semanas de lunes a domingo, hora de America/Monterrey; la semana en curso no entra.", "…" ]
}
```

| Campo | Notas |
|---|---|
| `date` | En milisegundos, como la guarda Mongo: el `201` es idéntico a lo que devuelve después `GET /v1/forecast/runs/:id` |
| `durationMs` | Tiempo del cálculo (lectura de datos + ajuste + validación + pronóstico) |
| `product.unit` | Unidad de **todas** las cantidades de la corrida (DF-2). Los clientes la muestran junto al número |
| `coverage` | Transacciones con el producto y tiendas que lo vendieron en la ventana (D-36). Salen aunque la corrida no esté disponible |
| `dataVersion.asOf` | Instantánea de core-process: solo cuentan las ventas registradas hasta ese instante |
| `history` | La foto (D-15): una fila por semana, con las cantidades ya convertidas |
| `validation.mape` | En porcentaje (`9.88` = 9.88 %). Nulo si las 4 reservadas son 0 |
| `model` | Parámetros de suavizamiento del ajuste final, para la ficha del algoritmo. `aic` es nulo (se omite en XML) si el ajuste no da un valor finito: nunca sale `Infinity` |
| `excludedPresentations` | Ventas que no se pudieron convertir (presentación sin contenido conocido); nunca se omiten en silencio |
| `limitations` | En una corrida disponible siempre trae la de la estacionalidad (DF-5); en una no disponible va vacía, porque no se ajustó ningún modelo. Agrega la de semanas rellenadas (DF-3), la de recorte (DF-7) y, con menos de 16 semanas para ajustar, "pocas semanas: el modelo estima 9 parámetros con N datos" |

En XML los nulos se omiten (`motivo`, `zone`, `dateFrom`…), y `history`, `forecast` y
`holdout` se envuelven en `<item>`.

### Corrida no disponible (D-36)

`201` con la corrida guardada, pero sin números del agregado
(`ejemplos/demand-forecast-run-no-disponible.json`):

```json
{
  "id": "674a20819e2b4d0012ab34ce", "type": "forecast", "disponible": false,
  "motivo": "Menos de 10 transacciones y menos de 3 tiendas con el producto en la zona (D-36).",
  "coverage": { "transactions": 9, "stores": 2 },
  "excludedPresentations": [], "limitations": [], "assumptions": [ "…" ]
}
```

Sin `dataVersion`, `history`, `validation`, `forecast` ni `model`: **nunca** sale un
número, ni `0`.

---

## GET /v1/forecast/runs

Query: `productId` (UUID), `zoneId` (UUID), `page`, `limit` (`paginacion.md`), todos
opcionales. Orden: más reciente primero. Response `200` (`forecastRunListResponse`),
`ejemplos/demand-forecast-runs.json`:

```json
{ "data": [ { "id": "674a1f3c9e2b4d0012ab34cd", "date": "2026-11-25T18:04:12.317000+00:00",
              "userId": "5b1e…", "productId": "3f6c…", "zoneId": "9792…", "unit": "l",
              "disponible": true, "weeks": 20, "mape": 9.880783430220134, "durationMs": 127.4 } ],
  "total": 2, "page": 1, "limit": 20 }
```

`weeks` y `mape` son nulos (se omiten en XML) en una corrida no disponible.

## GET /v1/forecast/runs/:id

La corrida completa, misma forma que el `201` (`forecastRunResponse`). `:id` que no es un
ObjectId → `400`; inexistente → `404`.

## POST /v1/forecast/runs/:id/replay

Recalcula la corrida **desde su foto** (`history` y `parameters` guardados), sin pedir
datos a core-process, y compara contra lo guardado. No crea una corrida nueva. Response
`200` (`forecastReplayResponse`), `ejemplos/demand-forecast-replay.json`:

```json
{ "runId": "674a1f3c9e2b4d0012ab34cd", "identical": true,
  "sha256": "be303c96…", "differences": [], "durationMs": 141.7 }
```

`identical` compara **exactamente** (sin tolerancia) `validation`, `forecast` y `model`.
Si algo difiere, `differences` trae `{ field, stored, recomputed }` por campo (p. ej. si
cambió la versión de statsmodels). Corrida inexistente → `404`; corrida
`disponible: false` → `409` (no tiene datos que recalcular).

---

## Casos de control (pruebas del servicio)

| Caso | Entrada | Resultado esperado |
|---|---|---|
| Frontera de historia | 11 semanas | `422`: "Hay 11 semanas de historia; el pronóstico necesita al menos 12 (D-40)." (`ejemplos/demand-forecast-error-422.json`) |
| Frontera de historia | 12 semanas | `201`, `trainWeeks: 8` |
| Patrón conocido | 52 semanas de `100 + 2t + [10, 0, −6, −4][t mod 4]` | `mape` < 0.5 % y cada semana pronosticada a menos de 0.5 unidades de la serie (medido: 0 % y valores exactos con 12, 16, 26 y 52 semanas) |
| Patrón con ruido | La misma serie + ruido normal (σ = 3, semilla 1) | `mape` < 3 % (medido: 1.41 % con 12 semanas, 1.09 % con 52) |
| Ceros en la validación | Las 4 semanas reservadas en 0 | `mape` nulo con motivo; `zeroWeeksExcluded: 4` |
| Semana rellenada | Una semana sin ventas en medio | `filled: true`, `zeroWeeks: 1` y aviso en `limitations` |
| Recorte | Serie con muchas semanas en 0 | Límites inferiores en 0 y `clipped: true` |
| Conversión | En una semana: 3 × "500 ml" y 1 × "1 l" | `quantity: 2.5`, `unit: "l"` |
| Tipos mezclados | Presentaciones en `pza` y en `kg` | `422` |
| D-36 | 9 transacciones / 3 tiendas; 10 / 2; 10 / 3 | No disponible; no disponible; disponible (`ambos`) |
| Reproducible | Misma corrida dos veces / `replay` | Mismo resultado; `identical: true` |
| Mongo caído | MongoDB detenido | `503 SERVICE_UNAVAILABLE`; `GET /v1/health` → `200 degraded` |

---

## Bitácora, aviso y linaje

Fire-and-forget **después de responder** (`BackgroundTasks`), con límite de 1.5 s,
reenviando el `Authorization` del usuario y el `X-Correlation-Id`. **Nunca cambian la
respuesta**; si fallan, queda una línea de log con el id de la corrida para reintentar.

| Qué | audit-service `POST /v1/auditoria` | notifications-service `POST /v1/notifications` | data-governance-service `POST /v1/lineage` |
|---|---|---|---|
| Corrida guardada (disponible o no) | `accion: ejecutar_corrida`, `tabla: forecast_runs`, `registroId: id`; `cambios`: `tipo: pronostico`, `disponible`, `mape` | `corrida.terminada` a quien la lanzó, `relatedEntityType: corrida`, `relatedEntityId: id` | `resourceType: corrida`, `resourceId: id`, fuente `ventas-core-process` con la versión `dataVersion.sha256` (formato en `data-governance-service.md`). Solo las corridas disponibles: una no disponible no tiene foto de datos |
| Replay | `accion: ejecutar_corrida`, `cambios`: `tipo: repeticion`, `identical` | — | — |

Un `4xx` no se reporta. Sin `AUDIT_SERVICE_URL`, `NOTIFICATIONS_SERVICE_URL` o
`DATA_GOVERNANCE_SERVICE_URL` no se envía esa llamada.

## Códigos de error

| Status | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo o query inválidos, campo desconocido, UUID mal formado, `dateFrom > dateTo`, `:id` que no es ObjectId |
| 401 | `UNAUTHORIZED` | Sin token, token revocado o sin sesión en Redis |
| 403 | `FORBIDDEN` | Rol sin permiso sobre la ruta |
| 404 | `NOT_FOUND` | Producto, zona o corrida inexistente |
| 409 | `CONFLICT` | `replay` de una corrida `disponible: false` |
| 422 | `VALIDATION_ERROR` | Menos de 12 semanas (DF-4); menos de `2 × SEASONAL_PERIOD` semanas para ajustar (DF-5); presentaciones de tipos distintos (DF-2) |
| 503 | `SERVICE_UNAVAILABLE` | Redis o MongoDB no responden (D-25); catalog-service o core-process-service no responden en 3 s |

---

## Lo que consume

Por **HTTP**, reenviando el `Authorization` del usuario y el `X-Correlation-Id`; si no
responden en 3 s → `503`. No lee tablas de otros servicios.

| Servicio | Ruta | Estado | Para qué |
|---|---|---|---|
| catalog-service | `GET /v1/products/:id` | Existe | Nombre del producto; `404` |
| catalog-service | `GET /v1/zones/:id` | Existe | Nombre de la zona; `404` |
| catalog-service | `GET /v1/products/:id/presentations` | Existe (solo activas) | `contenido`, `unidadMedida.tipo` y `factorBase` (DF-2) |
| core-process-service | `GET /v1/analytics/weekly-sales` | **Ruta nueva**, la implementa Leonardo (rama `feature/core-process-lecturas-analiticas`, avisado a Juan Ángel) | La serie semanal |

### Lectura nueva en core-process-service

`GET /v1/analytics/weekly-sales?productId=&zoneId=&dateFrom=&dateTo=&asOf=`: ventas de
un producto **agregadas por semana y presentación**. Sin paginar: es una serie completa
acotada por el filtro obligatorio `productId` (excepción de `paginacion.md`). Es un
cambio mínimo en el dominio de core-process (solo lectura, no toca rutas existentes),
como permite `CONTRIBUTING.md`; su contrato vive en `core-process-analytics.md`.

| Parámetro | Regla |
|---|---|
| `productId` | obligatorio, UUID |
| `zoneId` | opcional, UUID (zona congelada en la canasta, igual que los demás indicadores de core-process) |
| `dateFrom`, `dateTo` | opcionales, día local de Monterrey, inclusivos (mismo criterio que `/v1/transactions`) |
| `asOf` | opcional, instante ISO 8601: solo transacciones registradas hasta ese instante (instantánea repetible). Sin `asOf`, el servidor usa "ahora" y lo devuelve |

Respuesta esperada (`ejemplos/core-process-weekly-sales.json`):

```json
{ "productId": "3f6c…", "zoneId": "9792…", "timezone": "America/Monterrey",
  "weekStartsOn": "monday", "asOf": "2026-11-25T18:04:11.902000+00:00",
  "transactions": 1184, "stores": 4,
  "data": [ { "weekStart": "2026-07-06", "presentationId": "a1b2…", "quantity": 214, "transactions": 61 },
            { "weekStart": "2026-07-06", "presentationId": "b2c3…", "quantity": 79, "transactions": 48 } ] }
```

- `weekStart`: lunes de la semana en hora de Monterrey. Solo semanas con venta (el
  relleno con 0 lo hace este servicio, DF-3).
- `quantity`: número a 2 decimales (como los demás indicadores de core-process), en la
  unidad de la **presentación** (la conversión la hace este servicio).
- `transactions` y `stores` de arriba son **distintos** en toda la ventana (no se pueden
  sumar desde las filas): son la cobertura de D-36.
- XML con el XSD de core-process (`xsd/core-process/weekly-sales.xsd`).

### Ajuste pedido a catalog-service (Pamela)

`GET /v1/products/:id/presentations` devuelve **solo las activas**. Una presentación dada
de baja (D-07) con ventas viejas no se podría convertir. Se pide
`?includeInactive=true` (mismo objeto `Presentation`, con `activo: false`). Mientras no
exista, esas ventas quedan en `excludedPresentations` con su motivo.

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `PORT` | `3116` | |
| `SERVICE_NAME` | `demand-forecast-service` | Logs y health |
| `XML_NAMESPACE` | `forecast/v1` | Raíz XML |
| `MONGO_URL` | — | `forecast_runs` |
| `REDIS_URL`, `JWT_ACCESS_SECRET` | — | Sesión (plantilla) |
| `CATALOG_SERVICE_URL`, `CORE_PROCESS_SERVICE_URL` | — | Lecturas |
| `AUDIT_SERVICE_URL`, `NOTIFICATIONS_SERVICE_URL`, `DATA_GOVERNANCE_SERVICE_URL` | — | Bitácora, aviso y linaje |
| `SEASONAL_PERIOD` | `4` | DF-5 |
| `PUBLICATION_RULE` | `ambos` | DF-8 (P-11) |

## Limitaciones conocidas

- Estacionalidad de 4 semanas (DF-5); la anual queda fuera hasta tener 108 semanas.
- Con 12 semanas el ajuste de validación usa 8 puntos para 9 parámetros: el pronóstico es
  frágil y lo dice `limitations`.
- Una semana rellenada con 0 que en realidad fue falta de captura (no de demanda) baja la
  estacionalidad de esa posición del ciclo. Por eso se marca con `filled` y se avisa.
- Es una proyección de demanda agregada; no explica causas.

## Por confirmar

1. **Pamela:** `?includeInactive=true` en las presentaciones.
2. **Juan Ángel:** revisar `GET /v1/analytics/weekly-sales` en el PR de core-process.
3. **Juan Ángel (Matriz):** P-11 se decidió en este dominio (DF-8, `ambos`); falta
   incorporarlo a la Matriz §4, junto con la misma regla de basket-analysis (BA-5).
