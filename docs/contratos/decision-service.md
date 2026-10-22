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

## Avisos a notifications-service (D-12)

Después de cada operación exitosa, decision-service manda **un** aviso a
`POST {NOTIFICATIONS_SERVICE_URL}/v1/notifications`
(`sourceService: "decision-service"`; contrato en `notifications-service.md`):

| Evento | Cuándo | Quién lo origina | A quién llega |
|---|---|---|---|
| `escenario.generado` | Se guardó un escenario (`POST /v1/simulation/price` o `/presentation`) | Planeador | El usuario que simuló (`recipientUserId` = id del JWT) |
| `recomendacion.generada` | `POST /v1/recommendations/generate` guardó al menos una (un solo aviso por llamada, con los ids y el conteo) | Planeador | Rol Gerente de categoría |
| `recomendacion.resuelta` | `PATCH /v1/recommendations/:id/approve` o `/reject` (el mensaje dice aprobada o rechazada y, en el rechazo, el motivo) | Gerente de categoría | Rol Planeador, con copia automática al rol Auditor |

- **No se manda un segundo aviso al Auditor**: la copia la genera
  notifications-service por su cuenta.
- Se **reenvía el `Authorization` del usuario** que hizo la acción, nunca una
  cuenta de servicio ni un token propio: notifications-service valida el
  origen con el rol de ese token y responde 403 a cualquier otro rol
  (incluido el Administrador).
- **El fallo del aviso no afecta la operación**: no se espera su resultado
  para responder, tiene un timeout de 1.5 s y cualquier error (403, 5xx,
  timeout, servicio caído) solo queda en el log. Sin
  `NOTIFICATIONS_SERVICE_URL` no se envía nada.
- Si la operación falla (400, 404, 409…) no se manda ningún aviso.

## Lectura de datos de otros servicios (Fase B)

decision-service lee datos de otros dueños por **SQL de solo lectura** sobre
el Postgres compartido. **Nunca escribe tablas ajenas.**

| Dueño | Lo que lee |
|---|---|
| catalog-service | `productos`, `producto_presentaciones`, `zonas`, `tiendas`, `segmentos_ingreso`, `unidades_medida`, `zona_clasificaciones`, `indicadores`, `indicador_valores`, `inventario`; vista `v_zona_indicadores` |
| pricing-service | `precios` |
| core-process-service | `transacciones_detalle`, `canastas` |
| algorithms-core | `elasticidades`, `corrida_clusters`, y las corridas de elasticidad en `analisis_corridas` |
| Vistas del tablero | `v_dashboard_accesibilidad_zona` |

Por **HTTP** (no SQL), reenviando el `Authorization` de quien llama:

| Servicio | Ruta | Para qué |
|---|---|---|
| algorithms-core | `GET /v1/association/runs` y `GET /v1/association/runs/:id` | Regla 4 de recomendaciones (venta cruzada): reglas de la corrida de Apriori o FP-Growth completada más reciente. Las corridas viven en MongoDB (D3), así que no hay tabla que leer. Si algorithms-core no responde en 3 s o rechaza la llamada, `POST /v1/recommendations/generate` responde **503** con motivo; nunca omite la regla en silencio. La recomendación de venta cruzada sale con `runId: null` (la corrida no está en `analisis_corridas`) y el id de la corrida va en la descripción de su evidencia. |

Lo único que escribe son sus tablas: `accesibilidad_zona`,
`accesibilidad_pesos` y `accesibilidad_componentes`; `escenarios`,
`escenario_cambios` y `escenario_resultados`; `recomendaciones` y
`recomendacion_evidencias`; y sus propias corridas de accesibilidad en
`analisis_corridas` y `analisis_corrida_parametros` (tablas compartidas con
algorithms-core, que filtra por `tipo`).

**Límite conocido del Parcial 2 (D-27c):** `analisis_corridas` es de
algorithms-core y decision-service también escribe en ella sus corridas de
accesibilidad (`tipo = 'accesibilidad'`). No se agregan escrituras nuevas a
esa tabla, y toda consulta de decision-service que la toca filtra por `tipo`.

Es Fase B **a propósito**: en Fase C (Parcial 3) estas lecturas pasan a
llamadas HTTP a los servicios dueños. Hoy están en
`src/simulation/simulation.service.ts`,
`src/accessibility/accessibility.service.ts` y
`src/recommendations/recommendations.service.ts`.

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
con los parámetros con que se calculó cada una. **Solo lee: no calcula ni
persiste nada** (a diferencia de `/index`), así que es la ruta que deben usar
las pantallas.

Response `200`:

```json
[{ "zoneId": "uuid-zona", "segmentId": 2, "basicBasketCost": 187.5,
   "estimatedIncome": 30000.0, "indexValue": 0.62,
   "calculatedAt": "2026-09-20T12:00:00.000Z" }]
```

Una zona que **existe pero todavía no tiene corridas** responde `200` con la
lista **vacía** (`[]`), no 404: "no se ha calculado" es una respuesta válida.
Solo una zona que **no existe** da `404 NOT_FOUND`.

En XML la raíz es **`historialAccesibilidad`** con un `<item>` por corrida
(`docs/contratos/decision-service.xsd`); la lista vacía sale como el elemento
sin hijos. `indiceAccesibilidad` se queda para `/index`, que sí devuelve una
sola corrida; las dos comparten el tipo `accesibilidadCorrida`.

> Hasta el 20-oct-2026 el servicio devolvía **un solo objeto** con `LIMIT 1` y
> un `404` cuando la zona no tenía corridas: contradecía a este archivo y era
> el fallo **#10** de la corrida de integración. Se corrigió el servicio, no el
> contrato.

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

Compara **todas las presentaciones de un mismo producto** (D-14): desembolso,
precio unitario y demanda de cada una. Guarda el escenario.

Request JSON:

```json
{ "productId": "uuid-producto", "zoneId": "uuid-zona",
  "presentationIds": ["uuid-a", "uuid-b", "uuid-c"] }
```

`zoneId` opcional: sin ella usa datos nacionales. `presentationIds` opcional:
sin ella se comparan todas las presentaciones activas del producto.

**Mínimo 3 presentaciones (D-14).** No se mezclan productos.

| Código | Cuándo |
|---|---|
| 400 | `presentationIds` trae menos de 3; el producto tiene menos de 3 presentaciones activas; alguna presentación es de otro producto (D-14) o está inactiva |
| 404 | El producto o la zona no existen; menos de 3 de las presentaciones tienen precio vigente (las que no tienen se excluyen con aviso, nunca entran como 0) |

Response `201`: `PresentationComparisonResult` con `type: "presentacion"`.

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
