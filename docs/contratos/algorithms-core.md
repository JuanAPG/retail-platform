# Contrato: algorithms-core (Fase A — revisado en equipo antes de clientes)

Base: `http://algorithms-core:3105` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`algorithms-core.xsd`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}`. Listados paginados según
`paginacion.md`. Todas las rutas requieren `Authorization: Bearer <accessToken>` y
sesión activa en Redis (`SessionGuard`).

Rutas y campos en **inglés**, iguales a M10 y M11 del monolito
(`Contrato_Metodos_Endpoints`, Sprint 1): el código se traslada, no se reescribe.

> Cambios respecto al monolito: prefijo `/v1/`, error estándar, XML por `Accept`,
> `GET /v1/association/runs` pasa a la envoltura paginada, y se agrega
> `GET /v1/elasticity/current` (antes `decision-service` leía `elasticidades`
> directo por SQL).

> Secciones: `/v1/association` (M10) · `/v1/elasticity` (M11) · `/v1/substitution` (M11).

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/association/apriori/run` | Administrador, Analista comercial |
| GET | `/v1/association/runs` | Los 6 perfiles internos |
| GET | `/v1/association/runs/:id` | Los 6 perfiles internos |
| POST | `/v1/elasticity/calculate` | Administrador, Analista comercial |
| GET | `/v1/elasticity/chart` | Los 6 perfiles internos |
| GET | `/v1/elasticity/current` | Los 6 perfiles internos |
| GET | `/v1/substitution/patterns` | Los 6 perfiles internos |

Correr Apriori o calcular elasticidad **crea una corrida**, por eso solo
Administrador y Analista. El Proveedor no tiene acceso a ninguna ruta.

En XML, la raíz es el elemento de cada endpoint (p. ej. `<runListResponse
xmlns="algorithms/v1">`) y las fechas-hora van en ISO 8601 UTC. Un `null` sale
como elemento vacío (`<lift/>`) en los campos que el XSD exige presentes
(tipos `*OrEmpty`, declarados en `@XmlRoot(..., { siemprePresentes })`) y se
omite en los demás. Los errores con `Accept: application/xml` salen como
`<error>` con la misma forma que el JSON.

`503 SERVICE_UNAVAILABLE`: desde Fase C, cuando un servicio del que depende
(core-process, catalog, pricing, auth) no responde. Aplica a todas las rutas
que leen datos de otros servicios.

---

## /v1/association — Reglas de asociación (M10)

Toda corrida de Apriori queda guardada con sus parámetros, supuestos y filtros
para poder reproducirla y explicarla (RF-15). El antecedente de una regla es un
**conjunto** de productos (`items` con `side: "antecedente"`), nunca un texto.

### Objeto Run (corrida)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | |
| `type` | string | Siempre `asociacion` en esta sección |
| `status` | `completada` \| `fallida` | Las fallidas también se listan |
| `userId` | uuid \| null | Quién la ejecutó (sale del JWT, nunca del cuerpo) |
| `user` | `{ id, nombre }` \| null | Solo id y nombre del usuario |
| `date` | fecha-hora ISO | Cuándo se ejecutó (no es el periodo de los datos) |
| `periodStart`, `periodEnd` | `YYYY-MM-DD` | Periodo de los DATOS analizados |
| `transactionsConsidered`, `basketsConsidered` | int \| null | Iguales: una canasta = una transacción (RN-03). `null` si falló |
| `errorMessage` | string \| null | Obligatorio cuando `status = fallida` |
| `parameters` | `[{ runId, key, value }]` | `value` siempre texto |
| `assumptions` | `[{ runId, order, assumption }]` | Solo en `GET /runs/:id` |
| `filters` | `[{ runId, dimension, referenceId }]` | Solo en `GET /runs/:id`. Sin filas = todo el periodo |
| `results` | `Rule[]` | Solo en `GET /runs/:id` |

Claves de `parameters`: `algoritmo` (`apriori`), `soporte_minimo`,
`confianza_minima`, `tamano_maximo_itemset` y, en corridas completadas,
`reglas_generadas` y `reglas_excluidas_rn10`.

Valores de `dimension`: `tienda`, `zona`, `segmento` (`referenceId` es texto:
uuid de tienda o zona, número de segmento).

### Objeto Rule (regla)

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `runId` | uuid | |
| `support` | número, 5 decimales | Fracción de canastas que contienen la regla completa (0–1) |
| `confidence` | número, 5 decimales | P(consecuente \| antecedente), 0–1 |
| `lift` | número, 4 decimales \| null | > 1 = asociación positiva |
| `transactionCount` | int \| null | Canastas que contienen la regla completa |
| `items` | `[{ ruleId, productId, side, product }]` | `side`: `antecedente` \| `consecuente`; `product`: `{ id, sku, nombre, categoriaId }` |

Las reglas se ordenan por `confidence` desc, `lift` desc, `support` desc. En
cada regla, primero los ítems del antecedente y luego los del consecuente, por
nombre de producto. Los ítems apuntan a **producto**, no a presentación:
comprar leche de 1 L o de 500 ml es el mismo comportamiento de compra.

### POST /v1/association/apriori/run

Request JSON:

```json
{
  "minSupport": 0.2,
  "minConfidence": 0.5,
  "maxItemsetSize": 3,
  "zoneId": "uuid",
  "dateFrom": "2026-08-01",
  "dateTo": "2026-08-31"
}
```

| Campo | Regla |
|---|---|
| `minSupport` | **obligatorio**, número entre 0.01 y 1. Sin default oculto |
| `minConfidence` | **obligatorio**, número entre 0 y 1 |
| `maxItemsetSize` | opcional, entero entre 2 y 4; default 3 |
| `storeId`, `zoneId` | opcionales, UUID |
| `segmentId` | opcional, entero ≥ 1. Segmento de la ZONA de la compra (RN-02) |
| `dateFrom`, `dateTo` | opcionales, fecha ISO. `dateTo` abarca el día completo |

Campos no listados → `400` (`forbidNonWhitelisted`).

Qué se guarda: la corrida (`type: asociacion`), sus `parameters`, sus
`assumptions` (una canasta = una transacción; cuenta presencia y no cantidad;
exclusiones RN-10 aplicadas; RN-02 si se filtró por segmento) y sus `filters`.
Las reglas entre pares de categorías excluidos (RN-10) se descartan y se
cuentan en `reglas_excluidas_rn10`.

Response `201` (arreglo plano de `Rule`, sin paginar: es el resultado de la corrida):

```json
[
  {
    "id": "uuid",
    "runId": "uuid",
    "support": 0.24,
    "confidence": 0.75,
    "lift": 1.8,
    "transactionCount": 24,
    "items": [
      { "ruleId": "uuid", "productId": "uuid", "side": "antecedente",
        "product": { "id": "uuid", "sku": "LAC-001", "nombre": "Leche entera", "categoriaId": 2 } },
      { "ruleId": "uuid", "productId": "uuid", "side": "consecuente",
        "product": { "id": "uuid", "sku": "PAN-003", "nombre": "Pan de caja", "categoriaId": 5 } }
    ]
  }
]
```

Response XML (elemento `aprioriRunResponse` del XSD):

```xml
<response>
  <item>
    <id>uuid</id>
    <runId>uuid</runId>
    <support>0.24</support>
    <confidence>0.75</confidence>
    <lift>1.8</lift>
    <transactionCount>24</transactionCount>
    <items>
      <item>
        <ruleId>uuid</ruleId>
        <productId>uuid</productId>
        <side>antecedente</side>
        <product><id>uuid</id><sku>LAC-001</sku><nombre>Leche entera</nombre><categoriaId>2</categoriaId></product>
      </item>
      <item>
        <ruleId>uuid</ruleId>
        <productId>uuid</productId>
        <side>consecuente</side>
        <product><id>uuid</id><sku>PAN-003</sku><nombre>Pan de caja</nombre><categoriaId>5</categoriaId></product>
      </item>
    </items>
  </item>
</response>
```

Errores de entrada (fechas invertidas, ninguna canasta con esos filtros) → `400`
y **no** se crea corrida. Si falla después de leer los datos → `500` y la
corrida queda registrada como `fallida` con su `errorMessage`.

### GET /v1/association/runs

Query: `page`, `limit` (ver `paginacion.md`). Orden: más reciente primero.

Response `200`: envoltura paginada de `Run` **sin** `assumptions`, `filters` ni
`results` (las reglas pueden ser cientos por corrida; se piden con `/runs/:id`).

```json
{
  "data": [
    {
      "id": "uuid",
      "type": "asociacion",
      "status": "completada",
      "userId": "uuid",
      "user": { "id": "uuid", "nombre": "Ana Analista" },
      "date": "2026-10-01T15:30:00.000Z",
      "periodStart": "2026-08-01",
      "periodEnd": "2026-08-31",
      "transactionsConsidered": 100,
      "basketsConsidered": 100,
      "errorMessage": null,
      "parameters": [
        { "runId": "uuid", "key": "algoritmo", "value": "apriori" },
        { "runId": "uuid", "key": "confianza_minima", "value": "0.5" },
        { "runId": "uuid", "key": "soporte_minimo", "value": "0.2" }
      ]
    }
  ],
  "total": 12,
  "page": 1,
  "limit": 20
}
```

XML: elemento `runListResponse` (misma envoltura `<data><item>…</item></data>`,
`<total>`, `<page>`, `<limit>`).

### GET /v1/association/runs/:id

Una corrida completa: `Run` con `parameters` (por `key`), `assumptions` (por
`order`), `filters` (por `dimension`) y `results` (reglas, mismo orden que el
POST). Es lo necesario para reproducirla y explicarla.

```json
{
  "id": "uuid",
  "type": "asociacion",
  "status": "completada",
  "…": "…mismos campos que en el listado…",
  "assumptions": [
    { "runId": "uuid", "order": 1, "assumption": "Una canasta equivale a una transacción (RN-03)." }
  ],
  "filters": [ { "runId": "uuid", "dimension": "zona", "referenceId": "uuid" } ],
  "results": [ { "id": "uuid", "support": 0.24, "…": "…objeto Rule…" } ]
}
```

XML: elemento `runResponse`. `:id` no UUID → `400`. Corrida inexistente **o de
otro tipo** (p. ej. de elasticidad) → `404`.

### Códigos de error de esta sección

| Status | Cuándo |
|---|---|
| 400 | Cuerpo inválido o campo no permitido; umbrales fuera de rango; fechas invertidas; ninguna canasta con los filtros; `:id` no UUID |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso (p. ej. Planeador corriendo Apriori, o Proveedor) |
| 404 | Corrida inexistente o que no es de asociación |
| 500 | Falla durante el cálculo; la corrida queda `fallida` |

---

## /v1/elasticity — Elasticidad precio-demanda (M11)

Clasificación por la magnitud de E redondeada a 4 decimales: **elástica**
(`elastic`) si |E| > 1.05, **inelástica** (`inelastic`) si |E| < 0.95,
**unitaria** (`unitary`) entre ambas (|E| ≈ 1). Toda corrida guarda los datos
usados, el periodo y los supuestos.

### POST /v1/elasticity/calculate

Request JSON (todo opcional):

```json
{ "presentationId": "uuid", "dateFrom": "2026-08-01", "dateTo": "2026-08-31", "granularity": "day" }
```

| Campo | Regla |
|---|---|
| `presentationId` | opcional, UUID. Sin ella, todas las presentaciones con ventas en el periodo |
| `dateFrom`, `dateTo` | opcionales, fecha ISO. `dateTo` abarca el día completo |
| `granularity` | `day` (default) o `week` (semana ISO, empieza en lunes): cómo se agrupan las ventas en observaciones zona × periodo |

La elasticidad se calcula siempre **por cada zona más el agregado nacional**;
la comparación entre zonas o segmentos la hace `GET /v1/elasticity/chart`.

Claves de `parameters` guardadas: `metodo` (`regresion_log_log`),
`granularidad`, `observaciones_minimas` (3), `precios_distintos_minimos` (2),
`presentacion_id` (si se filtró), `resultados_calculados`,
`combinaciones_insuficientes`.

Response `201`:

```json
{
  "runId": "uuid",
  "periodStart": "2026-08-05",
  "periodEnd": "2026-08-15",
  "granularity": "day",
  "results": [
    {
      "presentationId": "uuid",
      "productName": "Leche entera",
      "presentationName": "1 L",
      "zoneId": null,
      "zoneName": "Nacional",
      "value": -1.35,
      "classification": "elastic",
      "rSquared": 0.62,
      "observations": 4,
      "atypical": false
    }
  ],
  "insufficient": [
    {
      "presentationId": "uuid",
      "productName": "Leche entera",
      "presentationName": "1 L",
      "zoneId": "uuid",
      "zoneName": "Zona Valle",
      "observations": 2,
      "distinctPrices": 1,
      "reason": "Un solo precio en el periodo: no se puede medir cómo reacciona la demanda al precio."
    }
  ],
  "assumptions": [
    "Modelo de elasticidad constante: cantidad = A · precio^E; E es la pendiente de ln(cantidad) contra ln(precio).",
    "…"
  ]
}
```

| Campo de `results[]` | Notas |
|---|---|
| `zoneId` / `zoneName` | `null` / `"Nacional"` = agregado nacional |
| `value` | E: % de cambio en la cantidad por cada 1 % de cambio en el precio |
| `classification` | `elastic` \| `inelastic` \| `unitary` |
| `rSquared` | número \| null |
| `observations` | Observaciones zona × periodo que respaldan el valor |
| `atypical` | `true` si E > 0 (la demanda sube con el precio): no se lee como una elasticidad normal |

`insufficient[]` lista las combinaciones presentación–zona sin datos
suficientes, con uno de estos `reason`: un solo precio en el periodo; menos de
3 observaciones; precios o cantidades no positivos.

XML: elementos `elasticityCalculateRequest` y `elasticityCalculateResponse`.

Fechas invertidas o ninguna venta con los filtros → `400` sin corrida.
Presentación inexistente → `404`. Falla durante el cálculo → `500` y la corrida
queda `fallida`.

### GET /v1/elasticity/chart

Datos del gráfico comparativo de una presentación. **No se pagina** (agregado
para gráfica, excepción declarada en `paginacion.md`).

| Query | Regla |
|---|---|
| `presentationId` | **obligatorio**, UUID |
| `groupBy` | `zone` (default) o `segment` |
| `runId` | opcional, UUID. Sin él, la corrida completada más reciente **con resultados** para esa presentación |

Response `200`:

```json
{
  "runId": "uuid",
  "presentationId": "uuid",
  "productName": "Leche entera",
  "presentationName": "1 L",
  "groupBy": "zone",
  "executedAt": "2026-10-01T15:30:00.000Z",
  "granularity": "day",
  "periodStart": "2026-08-05",
  "periodEnd": "2026-08-15",
  "bars": [
    { "key": "uuid", "label": "Zona Valle", "value": -1.2, "classification": "elastic", "observations": 4, "rSquared": 0.7 },
    { "key": "uuid", "label": "Zona Centro", "value": null, "classification": null, "observations": 0, "rSquared": null }
  ],
  "national": { "value": -1.35, "classification": "elastic", "observations": 4, "rSquared": 0.62 },
  "note": "Elasticidad de cada zona (análisis del 2026-10-01, observaciones por día). Barras vacías: sin datos suficientes."
}
```

- `bars` trae **todas** las zonas o segmentos, aunque no tengan valor, para que
  se vea cuáles no tuvieron datos.
- Con `groupBy=segment`, cada barra es el promedio de las zonas del segmento
  ponderado por observaciones (RN-02), y trae `zones` (zonas promediadas). Es
  una aproximación, y `note` lo dice.
- `national` es `null` si el agregado nacional no tuvo datos suficientes.

XML: elemento `elasticityChartResponse`. Presentación inexistente, `runId` que
no es una corrida de elasticidad completada, o ninguna corrida con resultados
para la presentación → `404`.

### GET /v1/elasticity/current

**Nuevo.** La elasticidad vigente: para cada par presentación–zona, el valor de
la **corrida completada más reciente** que lo calculó. Sustituye las consultas
SQL que `decision-service` hacía sobre `elasticidades` (simulación y
recomendaciones).

| Query | Regla |
|---|---|
| `presentationId` | opcional, UUID |
| `zoneId` | opcional, UUID. Devuelve las filas de esa zona **más las nacionales** (`zoneId: null`), que aplican a todas las zonas |
| `page`, `limit` | ver `paginacion.md` |

Orden: producto, presentación y zona; la fila nacional al final de cada
presentación. Así, quien busca "la de la zona y si no, la nacional" toma la
primera fila de la presentación.

Response `200`:

```json
{
  "data": [
    {
      "presentationId": "uuid",
      "productName": "Leche entera",
      "presentationName": "1 L",
      "zoneId": "uuid",
      "zoneName": "Zona Valle",
      "value": -1.2,
      "classification": "elastic",
      "rSquared": 0.7,
      "observations": 4,
      "runId": "uuid",
      "executedAt": "2026-10-01T15:30:00.000Z"
    },
    {
      "presentationId": "uuid",
      "productName": "Leche entera",
      "presentationName": "1 L",
      "zoneId": null,
      "zoneName": "Nacional",
      "value": -1.35,
      "classification": "elastic",
      "rSquared": 0.62,
      "observations": 4,
      "runId": "uuid",
      "executedAt": "2026-10-01T15:30:00.000Z"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20
}
```

Sin elasticidades calculadas → `data: []` (no es error; quien la consume decide
si eso es un `404` en su propio flujo). XML: elemento `currentElasticityListResponse`.

### Códigos de error de esta sección

| Status | Cuándo |
|---|---|
| 400 | Cuerpo o query inválidos; `granularity` o `groupBy` fuera de catálogo; fechas invertidas; ninguna venta con los filtros |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso (p. ej. Planeador calculando, o Proveedor) |
| 404 | Presentación inexistente; `runId` que no es corrida de elasticidad completada; ninguna corrida con resultados para graficar |
| 500 | Falla durante el cálculo; la corrida queda `fallida` |

---

## /v1/substitution — Patrones de sustitución (M11)

### GET /v1/substitution/patterns

Pares de productos de una categoría que se compran juntos **menos** de lo
esperado (lift < 1, medido sobre las canastas con productos de la categoría, y
solo si por azar se esperaba verlos juntos al menos una vez). Tipo `precio` si
además el precio vigente de A (histórico de precios) se correlaciona con
comprar B (r ≥ 0.3); si no, `preferencia`. Mínimo 2 canastas por producto.

**Se calcula al vuelo y no se guarda**; no se pagina (excepción declarada en
`paginacion.md`). No detecta `desabasto`: no hay historial de inventario.

| Query | Regla |
|---|---|
| `categoryId` | **obligatorio**, entero positivo (solo la categoría directa, sin subcategorías) |

Response `200` (arreglo plano):

```json
[
  {
    "originProductId": "uuid",
    "originProductName": "Leche entera",
    "targetProductId": "uuid",
    "targetProductName": "Leche deslactosada",
    "type": "precio",
    "score": 0.64,
    "lift": 0.4,
    "priceCorrelation": 0.52,
    "observations": 18,
    "periodStart": "2026-08-05",
    "periodEnd": "2026-08-15"
  }
]
```

| Campo | Notas |
|---|---|
| `originProduct*` | A: el que sube de precio o se deja de comprar |
| `targetProduct*` | B: el que lo reemplaza |
| `type` | `precio` \| `preferencia` |
| `score` | Fuerza del patrón, 0–1 |
| `lift` | < 1 = casi no se compran juntos |
| `priceCorrelation` | Correlación precio de A ↔ ventas de B; `null` si no hubo datos |
| `observations` | Canastas (o periodos, para la correlación) que respaldan el patrón |
| `periodStart`, `periodEnd` | Periodo de las canastas que compraron la categoría |

Categoría con menos de 2 productos, o sin canastas → `[]` (no es error).
XML: elemento `substitutionPatternListResponse`.

### Códigos de error de esta sección

| Status | Cuándo |
|---|---|
| 400 | Falta `categoryId` o no es entero positivo |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso (Proveedor) |
| 404 | Categoría inexistente |

---

## Lo que consume algorithms-core

Fase B: lectura por SQL de solo lectura en el Postgres compartido, aislada en
una sola clase. Fase C: esa clase pasa a llamar por HTTP, reenviando el
`Authorization` del usuario (cada servicio sigue validando JWT + Redis). Si el
servicio llamado no responde → `503 SERVICE_UNAVAILABLE`.

| Servicio | Qué necesita | Para qué |
|---|---|---|
| core-process-service | Líneas de canasta: `basketId`, `storeId`, `zoneId`, `segmentId`, `date`, `presentationId`, `quantity`, `unitPrice`. Filtrables por tienda, zona, segmento y rango de fechas, **sin paginar** (una corrida procesa todas las líneas del periodo) | Apriori, elasticidad, sustitución |
| catalog-service | Presentación → producto → categoría; nombres de producto y presentación; zonas; segmentos; productos de una categoría | Agrupar presentaciones en producto, nombres en respuestas, barras del gráfico |
| pricing-service | Histórico de precios por presentación: `presentationId`, `storeId`, `price`, `validFrom`, `validUntil` | Sustitución (precio vigente de A en cada canasta) |
| auth-service | Nombre del usuario que ejecutó la corrida (`user.nombre`) | Historial de corridas |

Tablas propias de algorithms-core (solo este servicio las escribe):
`analisis_corridas` y sus hijas `analisis_corrida_parametros`,
`analisis_corrida_supuestos`, `analisis_corrida_filtros`; `reglas_asociacion`,
`regla_asociacion_items`, `reglas_exclusion_asociacion`, `elasticidades`.

---

## Pendiente (no es parte de este contrato todavía)

- **Dueño de `analisis_corridas`:** accesibilidad (`decision-service`) también
  inserta corridas en el monolito. Acordar si la tabla es solo de
  algorithms-core o si se comparte.
- **`GET /v1/elasticity/current`:** confirmar con `decision-service` que cubre
  simulación (zona con respaldo nacional) y recomendaciones.
- **Nombre del usuario en Fase C:** `GET /v1/usuarios/:id` de auth-service es
  solo para Administrador; hace falta otra vía para que un perfil interno vea
  quién ejecutó una corrida.
- **Transversal (plantilla):** los XSD del equipo usan namespace (`…/v1`) pero
  el interceptor emite `<response>` sin namespace; ningún servicio acepta
  cuerpos XML (el escritorio necesita hacer POST en XML); el filtro de errores
  responde JSON aunque se pida XML; un `Date` sin convertir sale **vacío** en
  XML (`normalizarListas` lo trata como objeto sin campos), así que este
  servicio convierte sus fechas a texto ISO antes de responder.
