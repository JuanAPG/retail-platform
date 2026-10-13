# Contrato: analytics-stats (STA-01)

Base: `http://analytics-stats:3106` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`analytics-stats.xsd`, namespace `stats/v1`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}`. Listados paginados según
`paginacion.md`. Todas las rutas (salvo `/v1/health`) requieren
`Authorization: Bearer <accessToken>` y sesión activa en Redis (`sesion_actual`).

Servicio nuevo (no viene del monolito): RF-16 (clustering de zonas) y RF-20 a RF-22
(hipótesis, ANOVA y proporciones). Python + FastAPI con scipy, statsmodels y
scikit-learn. Rutas y campos en **inglés**, como algorithms-core; los textos para
el usuario (`conclusion`, `assumptions`) en español.

> Secciones: `/v1/hypothesis`, `/v1/anova`, `/v1/proportions` (RF-20 a RF-22) ·
> `/v1/clustering` (RF-16).

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/hypothesis/test` | Analista comercial |
| POST | `/v1/anova` | Analista comercial |
| POST | `/v1/proportions/compare` | Analista comercial |
| POST | `/v1/clustering/run` | Analista comercial |
| GET | `/v1/clustering/runs` | Los 6 perfiles internos |
| GET | `/v1/clustering/runs/:id` | Los 6 perfiles internos |

Roles según **D-24** (Matriz §4): igual que M10, ejecutar un análisis es del
Analista comercial y las corridas guardadas las leen los 6 perfiles internos. El
Proveedor no tiene acceso a ninguna ruta (`403`).

En XML, la raíz es el elemento de cada endpoint (p. ej. `<anovaResponse
xmlns="stats/v1">`), todo arreglo se envuelve en `<item>` por elemento y un `null`
**se omite** (los campos que pueden ser nulos son opcionales en el XSD). Los
números van **sin redondear** (`xs:double`): un p-value puede salir como
`1.2e-12`. Los cuerpos de las peticiones son **JSON** (como en todo el equipo,
ningún servicio lee cuerpos XML todavía).

`503 SERVICE_UNAVAILABLE`:

- Redis (sesiones) no responde: no se puede verificar la sesión.
- core-process-service o catalog-service no responden en **3 s** (modo
  `baskets` o clustering sin `zones`).
- MongoDB no responde (clustering): la corrida **no** se calcula a medias ni se
  devuelve sin guardar. Igual que documents-service.

---

## Pruebas estadísticas (RF-20, RF-21, RF-22)

Se calculan **al vuelo y no se guardan**. Responden `200`. Comparan **grupos
agregados** (segmentos o zonas), nunca personas.

### De dónde salen los datos

Cada petición trae **exactamente uno** de estos dos campos (ninguno o los dos →
`400`):

**`groups`: los valores en el cuerpo.**

```json
{ "groups": [ { "label": "Ingreso alto", "values": [143.2, 120.5, 98.0] },
              { "label": "Ingreso bajo", "values": [73.6, 80.1, 55.0] } ] }
```

| Campo | Regla |
|---|---|
| `groups` | 2 a 20 grupos (`hypothesis/test`: exactamente 2) |
| `label` | texto de 1 a 60 caracteres, sin repetirse |
| `values` | números finitos (texto, `NaN` o infinito → `400`); al menos 2 por grupo. Máximo **100 000 valores** sumando todos los grupos |

**`baskets`: los valores salen de las canastas de core-process.**

```json
{ "baskets": { "metric": "totalValue", "groupBy": "segment", "groupIds": ["3", "1"],
               "dateFrom": "2026-08-01", "dateTo": "2026-08-31" } }
```

| Campo | Regla |
|---|---|
| `metric` | `totalValue` (ticket, MXN), `productCount` (productos distintos) o `unitsTotal` (unidades). Solo en hipótesis y ANOVA |
| `condition` | `hasBasicProducts`, `chica`, `mediana` o `grande` (RN-05). Solo en proporciones: la canasta "cuenta" si cumple la condición |
| `groupBy` | `segment` o `zone` |
| `groupIds` | ids de segmento (entero) o de zona (UUID), sin repetirse; mismos límites de cantidad que `groups` |
| `dateFrom`, `dateTo` | opcionales, día `YYYY-MM-DD` (mismo criterio que core-process) |
| `storeId` | opcional, UUID |

El servicio pide `GET /v1/baskets` a core-process por grupo (con los mismos
filtros, páginas de 100) reenviando el `Authorization` del usuario. Cada canasta
es **un** valor (RN-03). El `label` de cada grupo es el nombre del segmento o de la
zona en catalog-service. Un grupo con menos de 2 canastas → `400` que lo nombra.

### Campos comunes

| Campo | Regla |
|---|---|
| `alpha` | opcional, número mayor a 0 y menor a 1; default `0.05` |

Toda respuesta trae:

| Campo | Tipo | Notas |
|---|---|---|
| `test` | string | La prueba que se aplicó (ver cada ruta) |
| `statistic` | número \| null | Estadístico de la prueba |
| `pValue` | número | |
| `alpha` | número | |
| `rejectNull` | boolean | `pValue < alpha` |
| `conclusion` | string | En español, como **diferencia estadística en estos datos**, nunca como causa |
| `source` | objeto \| null | Lo pedido en `baskets` (`null` si los datos vinieron en `groups`) |
| `assumptions` | string[] | Qué supone la prueba y qué se decidió (p. ej. por qué Mann-Whitney) |

### POST /v1/hypothesis/test (RF-20)

Compara **dos** grupos.

| Campo | Regla |
|---|---|
| `method` | opcional: `auto` (default), `welch` o `mannwhitney` |
| `alternative` | opcional: `two-sided` (default), `greater` o `less` (el primer grupo contra el segundo) |

- `auto` aplica **Welch** (t de Student sin suponer varianzas iguales,
  `scipy.stats.ttest_ind(equal_var=False)`); si algún grupo tiene **menos de 8**
  valores aplica **Mann-Whitney** (`scipy.stats.mannwhitneyu`) y lo dice en
  `assumptions`. `welch` o `mannwhitney` fuerzan esa prueba.
- Sin variación → `400`: en Welch, si los dos grupos son constantes; en
  Mann-Whitney, si todos los valores son iguales.

Response `200` (`hypothesisTestResponse`):

```json
{
  "test": "welch",
  "statistic": 8.271863737062235,
  "pValue": 1.1695308337398335e-11,
  "degreesOfFreedom": 63.19294386768545,
  "alpha": 0.05,
  "alternative": "two-sided",
  "rejectNull": true,
  "conclusion": "Con α = 0.05 hay diferencia estadística en el ticket entre Ingreso alto e Ingreso bajo (p < 0.0001). Es una diferencia en estos datos; no prueba una causa.",
  "groups": [
    { "label": "Ingreso alto", "n": 42, "mean": 143.20238095238096, "median": 142.0, "standardDeviation": 35.49288137555389 },
    { "label": "Ingreso bajo", "n": 30, "mean": 73.63333333333334, "median": 73.75, "standardDeviation": 34.95981272471473 }
  ],
  "source": { "metric": "totalValue", "groupBy": "segment", "groupIds": ["3", "1"], "dateFrom": null, "dateTo": null, "storeId": null },
  "assumptions": [
    "Welch: no supone que los dos grupos tengan la misma varianza.",
    "Grupos independientes: cada canasta pertenece a un solo grupo."
  ]
}
```

`statistic` es t (Welch) o U (Mann-Whitney). `degreesOfFreedom` es el de
Welch-Satterthwaite; `null` en Mann-Whitney. `standardDeviation` es la muestral
(n − 1). El ejemplo es el ticket real del CSV de 100 canastas
(`db/datos_prueba_100_canastas.csv`).

### POST /v1/anova (RF-21)

Compara **más de dos** grupos: ANOVA de un factor (`scipy.stats.f_oneway`).

- **Un** grupo → `400`.
- **Dos** grupos → se resuelve con la prueba de dos grupos de `hypothesis/test`
  (`method: auto`, `two-sided`), y `test` dice cuál se aplicó. Lo explica
  `assumptions`.
- Sin variación dentro de ningún grupo → `400`.

Response `200` (`anovaResponse`): los campos comunes, `groups` como en hipótesis y:

| Campo | Tipo | Notas |
|---|---|---|
| `test` | `anova` \| `welch` \| `mannwhitney` | |
| `statistic` | número | F (o t / U con dos grupos) |
| `dfBetween`, `dfWithin` | entero \| null | k − 1 y N − k; solo en `anova` |
| `degreesOfFreedom` | número \| null | Solo en `welch` |

`assumptions` recuerda que ANOVA supone varianzas parecidas y datos cercanos a la
normal en cada grupo, y avisa si algún grupo tiene menos de 8 valores.

### POST /v1/proportions/compare (RF-22)

Compara la **proporción** de casos que cumplen algo entre grupos. En lugar de
`values`, cada grupo trae conteos:

```json
{ "groups": [ { "label": "Ingreso alto", "successes": 30, "total": 42 },
              { "label": "Ingreso bajo", "successes": 12, "total": 30 } ] }
```

`successes` entero ≥ 0 y ≤ `total`; `total` entero ≥ 1 (`successes > total` o
`total = 0` → `400`). Con `baskets`, `successes` son las canastas del grupo que
cumplen `condition` y `total` todas las del grupo.

| Grupos | Prueba (`test`) |
|---|---|
| 2 | `ztest`: z de dos proporciones (`statsmodels proportions_ztest`, bilateral). Si algún conteo esperado (n·p o n·(1 − p), con p combinada) es menor a 5 → `fisher` (`scipy.stats.fisher_exact`) y se dice en `assumptions` |
| 3 a 20 | `chisquare`: χ² de homogeneidad (`statsmodels proportions_chisquare`). Con conteos esperados menores a 5 se avisa en `assumptions` |

Si todos los grupos tienen proporción 0 o todos 1 con 3 o más grupos → `400` (sin
variación).

Response `200` (`proportionsResponse`): los campos comunes y:

| Campo | Tipo | Notas |
|---|---|---|
| `test` | `ztest` \| `fisher` \| `chisquare` | |
| `statistic` | número \| null | z, χ², o la razón de momios en `fisher` (`null` si es infinita) |
| `degreesOfFreedom` | entero \| null | k − 1; solo en `chisquare` |
| `difference` | número \| null | proporción del primer grupo menos la del segundo; solo con 2 grupos |
| `groups` | `[{ label, successes, total, proportion }]` | |

### Códigos de error de esta sección

| Status | Cuándo |
|---|---|
| 400 | Cuerpo inválido; `groups` y `baskets` juntos o ninguno; número de grupos fuera de rango; grupo con menos de 2 valores; valor no numérico; sin variación; `successes > total`; `total = 0`; más de 100 000 valores |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Cualquier rol que no sea Analista comercial |
| 404 | Con `baskets`: segmento o zona inexistente en catalog-service |
| 503 | Redis no responde; core-process o catalog no responden en 3 s |

---

## /v1/clustering — Agrupación de zonas (RF-16)

Agrupa **zonas**, nunca personas (RF-16, RN-02), con **KMeans**
(`sklearn.cluster.KMeans`, `n_init=10`) sobre sus indicadores **estandarizados**
(z-score), con `k` y semilla fija. Cada corrida se guarda **completa en MongoDB**
(D3): parámetros, usuario, fecha, **los datos de entrada** y las asignaciones. Con
la entrada guardada y la semilla fija, repetirla da las mismas asignaciones (D-15).

La corrida **propone** grupos; no cambia la clasificación de las zonas. Clasificar
una zona sigue siendo `PUT /v1/zones/:id/classification` en catalog-service (ver
*Pendiente*).

### POST /v1/clustering/run

```json
{ "k": 2, "seed": 42, "features": ["estimatedIncome", "population", "availability", "averageTicket"],
  "dateFrom": "2026-08-01", "dateTo": "2026-08-31" }
```

| Campo | Regla |
|---|---|
| `k` | **obligatorio**, entero de 2 a 10, menor al número de zonas con datos |
| `seed` | opcional, entero ≥ 0; default `42` |
| `features` | opcional, 1 a 4 sin repetir de `estimatedIncome`, `population`, `availability` (catalog) y `averageTicket` (core-process); default los 4 |
| `zoneIds` | opcional, UUIDs; default todas las zonas de `GET /v1/zones` |
| `dateFrom`, `dateTo` | opcionales, ventana del `averageTicket` |
| `zones` | opcional: los datos en el cuerpo en lugar de pedirlos a catalog y core-process: `[{ zoneId, zoneName, estimatedIncome, population, availability, averageTicket }]`. No se combina con `zoneIds` ni con fechas |

- Sin `zones`, los indicadores salen de catalog (`GET /v1/zones/compare`) y el
  ticket de core-process (`GET /v1/analytics/average-ticket?zoneId=`).
- Una zona sin alguno de los indicadores elegidos **no se rellena con 0** (D-20):
  queda en `excludedZones` con el motivo.
- Las zonas se ordenan por `zoneId` antes de agrupar, y los clusters se numeran de
  1 a k por el promedio de la primera variable de `features`, de menor a mayor:
  el resultado no depende del orden en que lleguen.

Response `201` (`clusteringRunResponse`): la corrida guardada.

```json
{
  "id": "6713f0c2e4b0a1b2c3d4e5f6",
  "type": "clustering",
  "userId": "uuid",
  "date": "2026-10-12T22:15:03.123000+00:00",
  "parameters": { "k": 2, "seed": 42, "features": ["estimatedIncome", "population", "availability", "averageTicket"],
                  "source": "servicios", "dateFrom": "2026-08-01", "dateTo": "2026-08-31" },
  "input": [
    { "zoneId": "uuid", "zoneName": "Zona Centro", "estimatedIncome": 18500, "population": 120000, "availability": 0.8, "averageTicket": 96.4 }
  ],
  "clusters": [
    { "cluster": 1, "size": 2, "centroid": { "estimatedIncome": 14000, "population": 95000, "availability": 0.7, "averageTicket": 85.0 } }
  ],
  "assignments": [ { "zoneId": "uuid", "zoneName": "Zona Centro", "cluster": 1 } ],
  "excludedZones": [ { "zoneId": "uuid", "zoneName": "Zona Norte", "reason": "Sin población cargada." } ],
  "inertia": 0.53,
  "silhouette": 0.41,
  "assumptions": [
    "Se agrupan zonas, nunca personas (RF-16).",
    "Indicadores estandarizados (z-score): ninguno pesa más por su unidad.",
    "KMeans con semilla 42: con los mismos datos, las mismas asignaciones."
  ]
}
```

`parameters` repite lo pedido (`k`, `seed`, `features` y, si vinieron, `zoneIds`,
`dateFrom`, `dateTo`) y agrega `source`: `servicios` (catalog + core-process) o
`cuerpo` (`zones`).
`centroid` va en las unidades originales. `inertia` es la de KMeans sobre los datos
estandarizados; `silhouette` (−1 a 1) mide qué tan separados quedaron los grupos.

### GET /v1/clustering/runs

Query: `page`, `limit` (ver `paginacion.md`). Orden: más reciente primero.
Response `200` (`clusteringRunListResponse`): envoltura paginada de corridas **sin**
`input`, `clusters`, `assignments`, `excludedZones` ni `assumptions`, con
`zoneCount` (zonas agrupadas).

### GET /v1/clustering/runs/:id

La corrida completa, misma forma que el `201` (`clusteringRunResponse`). `:id` que
no es un ObjectId de Mongo → `400`; inexistente → `404`.

### Códigos de error de esta sección

| Status | Cuándo |
|---|---|
| 400 | Cuerpo inválido; `k` fuera de rango o no menor a las zonas con datos; `features` repetidas o desconocidas; `zones` junto con `zoneIds` o fechas; `:id` mal formado |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Correr: cualquier rol que no sea Analista comercial. Leer: Proveedor |
| 404 | Corrida inexistente; zona de `zoneIds` inexistente en catalog-service |
| 503 | Redis o MongoDB no responden; catalog o core-process no responden en 3 s |

---

## Bitácora y aviso (STA-04)

Fire-and-forget con límite de 1.5 s, reenviando el `Authorization` del usuario,
igual que algorithms-core (ALG-10): **nunca cambian la respuesta** del análisis.

| Qué | audit-service `POST /v1/auditoria` | notifications-service `POST /v1/notifications` |
|---|---|---|
| Corrida de clustering | `accion: ejecutar_corrida`, `tabla: analysis_runs`, `registroId: id` | `corrida.terminada` a quien la lanzó, `relatedEntityType: corrida`, `relatedEntityId: id` |
| Hipótesis, ANOVA, proporciones | `accion: ejecutar_corrida`, `tabla: analisis_estadistico`, `registroId: null` | — |

Las pruebas no avisan: no se guardan, así que el aviso no tendría nada que abrir, y
el resultado ya llega en la respuesta. Un `400` no se reporta.

## Lo que consume analytics-stats

Por **HTTP**, reenviando el `Authorization` del usuario; si no responden en 3 s →
`503`. No lee tablas de otros servicios.

| Servicio | Qué | Para qué |
|---|---|---|
| core-process-service | `GET /v1/baskets` (filtros `segmentId`/`zoneId`, `storeId`, fechas, `hasBasicProducts`, `size`; páginas de 100) | Valores y conteos del modo `baskets` |
| core-process-service | `GET /v1/analytics/average-ticket?zoneId=` | `averageTicket` del clustering |
| catalog-service | `GET /v1/zones`, `GET /v1/zones/compare?ids=` | Zonas e indicadores del clustering |
| catalog-service | `GET /v1/segments/:id`, `GET /v1/zones/:id` | Nombre (`label`) de cada grupo |

Datos propios: colección **`analysis_runs`** de MongoDB (D3), documentos con
`type: "clustering"`, índice `{ userId: 1, date: -1 }`. No escribe en PostgreSQL.

---

## Pendiente (no es parte de este contrato todavía)

- **D3 frente al esquema:** `corrida_clusters` y `zona_clasificaciones.corrida_id`
  esperan la corrida de clustering en `analisis_corridas` (PostgreSQL), pero D3 la
  guarda en MongoDB. Hasta decidirlo, el clustering solo propone grupos y la
  clasificación de zonas sigue siendo manual en catalog-service.
- **503 de MongoDB:** `services/snippets/error-codes.md` dice que un fallo de Mongo es
  `500 INTERNAL`; este contrato usa `503`, como documents-service y como pide QA
  (STA-03). Conviene alinear el snippet.
- **Volumen (Parcial 3):** con 50 000 canastas, el modo `baskets` pide 500 páginas a
  core-process. Si hace falta, core-process tendría que exponer los valores
  agregados por grupo.
- **Con los datos de prueba** hay 3 zonas: el clustering solo admite `k = 2`. RN-02 ya
  aclara que los datos de prueba usan 3 municipios.
