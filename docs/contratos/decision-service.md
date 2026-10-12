# Contrato: decision-service (Fase A)

Base: `http://decision-service:3107` · Rutas `/v1/`, JSON por defecto y XML
si `Accept: application/xml` (XSD en `decision-service.xsd`). Errores con el
cuerpo estándar. Requiere sesión (SessionGuard); lectura para perfiles
internos. Según la matriz de permisos, simular (M13) y generar
recomendaciones (M14) es solo del **Planeador**; Administrador y Analista
tienen solo lectura ahí. Aprobar o rechazar una recomendación es solo del
**Gerente de categoría** (D-12: "genera el Planeador, decide el Gerente").
`GET /v1/accessibility/index` sigue siendo de Administrador y Analista.

Bitácora: cada simulación (precio o presentación) se registra en
audit-service con acción `simular` (tabla `escenarios`, id del escenario);
cada recomendación creada por `generate`, con `generar_recomendacion`
(tabla `recomendaciones`, una entrada por recomendación); cada decisión
del Gerente, con `aprobar` o `rechazar` (tabla `recomendaciones`; la
descripción lleva quién decidió y, en el rechazo, el motivo); cada cálculo
del índice, con `ejecutar_corrida` (tabla `analisis_corridas`). Se reenvía el
`Authorization` del usuario; si audit-service falla, la operación no se
rompe.

## GET /v1/accessibility/index?zoneId&segmentId

Calcula el índice **ahora mismo** y crea una corrida nueva (no pisa la
anterior: así se ve la evolución en el tiempo).

> **Ojo (QA-DEC51-08): es una escritura disfrazada de GET.** Aunque el
> verbo es GET, cada llamada CALCULA Y PERSISTE una corrida nueva en
> `analisis_corridas` (con sus parámetros, índice, pesos y componentes) y
> deja un evento `ejecutar_corrida` en la bitácora. No es idempotente: no
> lo pongas detrás de refrescos automáticos, polling ni precarga de
> pantallas, porque cada visita crea una corrida. Para **leer** la
> accesibilidad vigente sin generar corridas usa
> `GET /v1/accessibility/by-zone/:zoneId`. Se mantiene como GET por el
> contrato original; moverlo a POST queda como decisión pendiente del
> equipo.

Response `200`:

```json
{
  "zoneId": "uuid-zona",
  "segmentId": 2,
  "basicBasketCost": 187.5,
  "estimatedIncome": 30000.0,
  "indexValue": 0.62
}
```

`indexValue` en 0–1: NUNCA se lee como "precio bajo"; es el promedio
ponderado de precio, ingreso del segmento, disponibilidad y cobertura de
básicos. Zona o segmento inexistente → 404 `NOT_FOUND`.

## GET /v1/accessibility/by-zone/:zoneId

Historial de corridas de la zona (de la más reciente a la más antigua),
con los parámetros con que se calculó cada una.

Response `200`:

```json
[{ "zoneId": "uuid-zona", "segmentId": 2, "basicBasketCost": 187.5,
   "estimatedIncome": 30000.0, "indexValue": 0.62,
   "calculatedAt": "2026-09-20T12:00:00.000Z" }]
```

## POST /v1/simulation/price (Planeador)

Simula un cambio de precio con la elasticidad ya calculada y guarda el
escenario automáticamente (igual que Apriori guarda su corrida: no hay
endpoint separado para "guardar").

Request JSON:

```json
{ "presentationId": "uuid-presentacion", "zoneId": "uuid-zona", "newPrice": 25.5 }
```

Sin elasticidad previa para esa presentación/zona → 404 `NOT_FOUND` (no se
inventa demanda). Sin precio vigente → 404. Response `201`:

```json
{
  "type": "price", "productId": "uuid", "presentationId": "uuid",
  "zoneId": "uuid-zona", "segmentId": 2,
  "inputs": { "currentPrice": 28.5, "newPrice": 25.5, "elasticity": -1.2 },
  "results": [
    { "indicatorKey": "demanda_estimada", "zoneId": "uuid-zona",
      "baseValue": 100, "simulatedValue": 112.4, "variacionPct": 12.4 },
    { "indicatorKey": "ingreso_estimado", "zoneId": "uuid-zona",
      "baseValue": 2850.0, "simulatedValue": 2856.2, "variacionPct": 0.22 }
  ],
  "scenarioId": "uuid-escenario"
}
```

## POST /v1/simulation/presentation (Planeador)

Compara presentación A (base) contra B (alternativa): desembolso, precio
unitario y demanda. Guarda el escenario.

Request JSON:

```json
{ "presentationIdA": "uuid-a", "presentationIdB": "uuid-b", "zoneId": "uuid-zona" }
```

(`zoneId` opcional: sin ella usa datos nacionales.) Response `201`:
`SimulationResult` con `type: "presentation"`.

## GET /v1/simulation/scenarios

Escenarios guardados. Response `200`: `[{ id, nombre, zonaId, creadoPor, createdAt }]`.

## GET /v1/simulation/compare?ids=id1,id2

Compara escenarios entre sí. Response `200`:

```json
{
  "scenarioIds": ["uuid-1", "uuid-2"],
  "scenarioNames": { "uuid-1": "Cambio de precio - …" },
  "rows": [{ "indicatorKey": "ingreso_estimado", "zonaId": "uuid-zona",
              "valuesByScenario": { "uuid-1": 2856.2, "uuid-2": 2790.0 } }]
}
```

## POST /v1/recommendations/generate (Planeador)

Evalúa las 4 reglas (accesibilidad, elasticidad, simulación, asociación)
y persiste lo generado en una sola transacción. `evaluateRules` es interno
(no tiene endpoint, igual que `saveRun`/`saveScenario`).

Request JSON: `{ "zoneId": "uuid-zona" }` (opcional; la regla de
asociación nunca se acota por zona). Response `201`: arreglo de
recomendaciones (`[]` si ninguna regla dispara — no es error).

**Reemplaza las propuestas pendientes, no las acumula.** En la misma
transacción, antes de insertar, borra las recomendaciones en `propuesta`
del alcance evaluado (su evidencia se va con ellas, `ON DELETE CASCADE`):

- Sin `zoneId`: se evaluaron todas las zonas, así que borra **todas** las
  `propuesta`.
- Con `zoneId`: borra las `propuesta` de esa zona, más las `propuesta` sin
  zona cuyo título coincide con el de un borrador nuevo sin zona (las de
  asociación no dependen de zona y se volverían duplicadas).

Las `aceptada` y `descartada` **nunca** se borran: son el historial de
decisiones. Si ninguna regla dispara (respuesta `[]`), no se borra nada.

## GET /v1/recommendations (perfiles internos)

Lista paginada (paginación estándar, igual que `GET /v1/simulation/scenarios`),
de la más reciente a la más antigua (`generatedAt` descendente). Filtros
opcionales:

| Query | Valores |
|---|---|
| `zoneId` | UUID de zona |
| `status` | `propuesta` \| `aceptada` \| `descartada` |
| `page`, `limit` | estándar (`limit` > 100 se recorta a 100) |

`zoneId` que no es UUID o `status` fuera de la lista → 400 `VALIDATION_ERROR`
con `details`. XML: raíz `recomendacionesPageResponse`. Response `200`:

```json
{
  "data": [{
    "id": "uuid", "title": "Accesibilidad baja en zona Centro",
    "whatRecommends": "…", "why": "…", "estimatedImpact": "…",
    "zoneId": "uuid-zona", "scenarioId": null, "runId": "uuid-corrida",
    "status": "propuesta", "generatedAt": "2026-10-12T18:00:00.000Z"
  }],
  "total": 1, "page": 1, "limit": 20
}
```

## PATCH /v1/recommendations/:id/approve (Gerente de categoría)

Pasa una recomendación de `propuesta` a `aceptada`. Sin body. Response
`200`: la misma forma que `explain` con el `status` nuevo (XML: raíz
`recomendacion`).

```json
{ "recommendationId": "uuid", "title": "…", "whatRecommends": "…", "why": "…",
  "estimatedImpact": "…", "evidence": [ … ], "status": "aceptada",
  "generatedAt": "2026-10-12T18:00:00.000Z" }
```

## PATCH /v1/recommendations/:id/reject (Gerente de categoría)

Pasa una recomendación de `propuesta` a `descartada`. Body obligatorio:

```json
{ "motivo": "El ajuste de precio no aplica en temporada escolar." }
```

`motivo` de 10 a 500 caracteres. Response `200`: forma de `explain` con
`"status": "descartada"`. El motivo no tiene columna en `recomendaciones`:
queda en la bitácora (evento `rechazar`).

Errores de approve y reject:

| Código | Cuándo |
|---|---|
| 400 | `id` no es UUID; en reject, `motivo` falta, es menor a 10 o mayor a 500 caracteres |
| 403 | Quien llama no es Gerente de categoría (ni Administrador ni Planeador deciden) |
| 404 | La recomendación no existe |
| 409 | Ya no está en `propuesta` (ya fue aceptada o descartada): no se decide dos veces |

La transición es atómica (`UPDATE … WHERE id = $1 AND estatus = 'propuesta'`):
si dos decisiones llegan a la vez, solo una pasa y la otra recibe 409.

## GET /v1/recommendations/:id/explain

Explica una recomendación ya generada. Response `200`:

```json
{
  "recommendationId": "uuid", "title": "…",
  "whatRecommends": "…", "why": "…", "estimatedImpact": "…",
  "evidence": [{ "dimension": "zona|producto|…", "referenceId": "…", "description": "…" }],
  "status": "propuesta", "generatedAt": "2026-09-20T12:00:00.000Z"
}
```

Toda recomendación responde qué, por qué, con qué datos y qué impacto
estima; sin esas cuatro, no se persiste.
