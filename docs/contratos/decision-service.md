# Contrato: decision-service (Fase A)

Base: `http://decision-service:3107` · Rutas `/v1/`, JSON por defecto y XML
si `Accept: application/xml` (XSD en `decision-service.xsd`). Errores con el
cuerpo estándar. Requiere sesión (SessionGuard); lectura para perfiles
internos, lo que calcula/guarda para Administrador y Analista (mismo
criterio que M10/M11).

## GET /v1/accessibility/index?zoneId&segmentId

Calcula el índice **ahora mismo** y crea una corrida nueva (no pisa la
anterior: así se ve la evolución en el tiempo).

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

## POST /v1/simulation/price (Administrador, Analista)

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

## POST /v1/simulation/presentation (Administrador, Analista)

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

## POST /v1/recommendations/generate (Administrador, Analista)

Evalúa las 4 reglas (accesibilidad, elasticidad, simulación, asociación)
y persiste lo generado en una sola transacción. `evaluateRules` es interno
(no tiene endpoint, igual que `saveRun`/`saveScenario`).

Request JSON: `{ "zoneId": "uuid-zona" }` (opcional; la regla de
asociación nunca se acota por zona). Response `201`: arreglo de
recomendaciones (`[]` si ninguna regla dispara — no es error).

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
