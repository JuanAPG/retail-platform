# Contrato: basket-analysis-service (T-06 · T-12 · Sprint 4)

Base: `http://basket-analysis-service:3113` · Todas las rutas cuelgan de `/v1/` y son
**nuevas** (el servicio no existía). Responde JSON por defecto y XML si
`Accept: application/xml` (XSD en `basket-analysis-service.xsd`, namespace
`basket-analysis/v1`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}`. Todas las rutas (menos
`GET /v1/health`) requieren `Authorization: Bearer <accessToken>` y sesión activa en Redis
(`sesion_actual`).

Plantilla: `services/template-fastapi/` (con T-02: `X-Correlation-Id` y health con
dependencias). `GET /v1/health` sigue `health.xsd` y revisa `redis` (`postgres` y
`mongodb`: `no configurado`). Rutas y campos en **inglés**, como los demás servicios
de analítica; los textos para el usuario (`motivo`, `assumptions`) en español.

Decisiones que aplica: **D-37** (canasta típica de un grupo zona + segmento, umbral de
20 %), **D-36** (ningún agregado con pocos datos), **D-35** (versión del segmento),
**D-15** (misma instantánea, mismo resultado) y RN-02 (el segmento es de la **zona
agregada**, congelado en la canasta al construirla; nunca de una persona). Según D-37,
core-process conserva sus 5 indicadores; este servicio agrega la canasta típica, la
comparación entre periodos, la evolución y la mezcla por categoría.

Ejemplos ejecutables (JSON y XML validado contra el XSD) en `docs/contratos/ejemplos/`,
con el prefijo `basket-analysis-`.

## Almacenamiento

Ninguno. Todo se calcula al vuelo con lecturas HTTP. No guarda corridas, así que no usa
MongoDB ni PostgreSQL; Redis solo para la sesión. La reproducibilidad (D-15) se da con la
**instantánea** `asOf`: la misma consulta con el mismo `asOf` devuelve lo mismo, y cada
respuesta trae el SHA-256 de los datos que usó.

## Permisos (Matriz §3.2)

| Admin | Analista | Gerente | Resp. precios | Planeador | Auditor | Proveedor | Investigador |
|---|---|---|---|---|---|---|---|
| L | L | L | L | L | L | – | – |

Todas las rutas son de consulta. Es la lectura de M07 (Canastas) para los 6 perfiles
internos.

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/typical-basket` | Los 6 perfiles internos |
| GET | `/v1/typical-basket/compare` | Los 6 perfiles internos |
| GET | `/v1/basket-evolution` | Los 6 perfiles internos |
| GET | `/v1/category-mix` | Los 6 perfiles internos |

Proveedor e Investigador de mercado → `403` en todas.

---

## Reglas del dominio

Decididas por el dueño del dominio (guía del Parcial 3), dentro de D-37 y D-36.

| ID | Regla |
|---|---|
| **BA-1** | **Grupo** = zona + segmento **congelado en la canasta** al construirla (RN-02; es el `segmentId` de `GET /v1/baskets` y el filtro de los indicadores de core-process). `zoneId` y `segmentId` son **obligatorios** en todas las rutas. |
| **BA-2** | **Un producto cuenta una vez por canasta**, aunque la canasta lleve varias presentaciones de él (500 ml y 1 l son el mismo producto). |
| **BA-3** | **Umbral (D-37):** un producto es típico si `canastasConProducto × 5 ≥ canastasDelGrupo`. Se compara con **enteros** (20 % = 1/5) para que 20 % entre siempre y 19 % nunca, sin errores de redondeo. Frontera: 20 de 100 → entra; 19 de 100 → no entra. |
| **BA-4** | **Frecuencia** = canastas con el producto / canastas del grupo (0 a 1). **Gasto promedio** = lo gastado en el producto (suma de sus subtotales) / canastas que lo llevan, en MXN a 2 decimales. |
| **BA-5** | **Publicación (D-36):** el grupo se publica solo si tiene **al menos 10 transacciones** (una canasta = una transacción) **y al menos 3 tiendas** con venta en el periodo. Si no, `disponible: false` con `motivo` y **sin ningún número del agregado**. Los conteos `coverage` sí salen, como en income-segmentation-service. **P-11, decidido en este dominio:** hacen falta **los dos** umbrales (`PUBLICATION_RULE=ambos`), porque el riesgo de D-36 es describir a una sola tienda y es la lectura que más protege; además coincide con income-segmentation-service. Frontera: 10 transacciones en 2 tiendas → no disponible; 10 en 3 → disponible. La variable permite cambiar a `cualquiera` sin tocar código. Un grupo **sin canastas** responde `200` con `disponible: false` y su motivo, no `404`. |
| **BA-6** | **Cambio de segmento:** si la zona se reclasifica a mitad del periodo, sus canastas quedan repartidas entre los dos grupos (cada una con el segmento con que nació). Ninguna se cuenta dos veces: la suma de canastas de los dos grupos es la de la zona. `group.segment.versions` lista las versiones del segmento con que la zona estuvo clasificada en el periodo (D-35). |
| **BA-7** | **Orden:** productos por frecuencia descendente y, a igual frecuencia, por `productId`. El resultado no depende del orden en que lleguen los datos. |
| **BA-8** | **Instantánea (D-15):** `asOf` (opcional) fija hasta qué instante cuentan las ventas registradas. Sin `asOf`, el servicio toma "ahora" y lo devuelve; repetir con ese `asOf` da el mismo resultado y el mismo `dataVersion.sha256`. |

Proporciones sin redondear (`xs:double`); importes en MXN a 2 decimales.

---

## Parámetros comunes

| Parámetro | Regla |
|---|---|
| `zoneId` | **obligatorio**, UUID. Inexistente en catalog-service → `404` |
| `segmentId` | **obligatorio**, entero ≥ 1. Inexistente en income-segmentation-service → `404` |
| `dateFrom`, `dateTo` | `YYYY-MM-DD`, día local de America/Monterrey, inclusivos (mismo criterio que core-process). `dateFrom > dateTo` → `400` |
| `asOf` | opcional, instante ISO 8601 (BA-8) |

Cualquier otro parámetro → `400`.

## GET /v1/typical-basket

Query: los comunes (fechas opcionales: sin ellas, todo el historial) e `includeAll`
(`true`/`false`, default `false`: con `true` también lista los productos que **no**
alcanzan el 20 %, con `typical: false`, para ver la frontera).

Response `200` (`typicalBasketResponse`), `ejemplos/basket-analysis-typical.json`: grupo
sintético de 100 canastas en 4 tiendas (el tipo de datos que dará el generador), con
`includeAll=true`:

```json
{
  "group": { "zone": { "id": "9792…", "name": "Zona Centro" },
             "segment": { "id": 2, "code": "ING_2", "name": "Ingreso medio", "versions": [1] } },
  "period": { "dateFrom": "2026-10-01", "dateTo": "2026-10-31" },
  "asOf": "2026-11-25T18:20:00.000000+00:00",
  "threshold": 0.2, "publicationRule": "ambos", "minTransactions": 10, "minStores": 3,
  "coverage": { "baskets": 100, "stores": 4 },
  "disponible": true, "motivo": null,
  "summary": { "baskets": 100, "totalSpend": 10983.5, "averageTicket": 109.83,
               "productsPerBasket": 2.3, "basketsPerWeek": 22.58064516129032 },
  "products": [
    { "productId": "a3f1…c01", "productName": "Leche entera", "categoryId": 2, "categoryName": "Lácteos",
      "basketsWithProduct": 62, "frequency": 0.62, "averageSpend": 57.0, "typical": true },
    "…",
    { "productId": "a3f1…c05", "productName": "Queso panela", "categoryId": 2, "categoryName": "Lácteos",
      "basketsWithProduct": 20, "frequency": 0.2, "averageSpend": 55.5, "typical": true },
    { "productId": "a3f1…c06", "productName": "Quinoa orgánica", "categoryId": 1, "categoryName": "Abarrotes",
      "basketsWithProduct": 19, "frequency": 0.19, "averageSpend": 92.0, "typical": false }
  ],
  "typicalSize": 5,
  "dataVersion": { "sha256": "6709f690…", "source": "core-process-service",
                   "asOf": "2026-11-25T18:20:00.000000+00:00" },
  "assumptions": [ "Grupo = zona + segmento congelado en cada canasta al construirla (RN-02).", "…" ]
}
```

| Campo | Notas |
|---|---|
| `summary.averageTicket` | Gasto total / canastas: debe coincidir con `GET /v1/analytics/average-ticket` de core-process con los mismos filtros (prueba de integración) |
| `summary.productsPerBasket` | Productos **distintos** por canasta (BA-2): coincide con `products-per-basket` de core-process |
| `summary.basketsPerWeek` | Canastas / semanas del periodo (días / 7): la frecuencia de compra del grupo, agregada, nunca por cliente |
| `products` | Sin `includeAll`, solo los típicos |
| `typicalSize` | Cuántos productos son típicos |
| `categoryId` | Se omite en un producto sin categoría (`categoryName: "Sin categoría"`), como en core-process |

**No disponible (D-36).** Caso **real** con el CSV de 100 canastas cargado sobre el seed
(`ejemplos/basket-analysis-typical-no-disponible.json`). El seed tiene **una tienda por
zona**, así que con `ambos` ningún grupo alcanza 3 tiendas:

```json
{ "group": { "zone": { "name": "Zona Valle" }, "segment": { "id": 3, "code": "ING_3" } },
  "period": { "dateFrom": "2026-08-01", "dateTo": "2026-09-30" },
  "coverage": { "baskets": 40, "stores": 1 },
  "disponible": false,
  "motivo": "La combinación zona-segmento tiene 1 tienda (mínimo 3) con 40 canastas (D-36, regla ambos)." }
```

Sin `summary`, `products`, `typicalSize` ni `dataVersion`: **nunca** sale un número del
agregado, ni `0`.

## GET /v1/typical-basket/compare

Compara la canasta típica del mismo grupo en dos periodos. Query: `zoneId`, `segmentId`,
`periodAFrom`, `periodATo`, `periodBFrom`, `periodBTo` (los cuatro **obligatorios**; en
cada periodo `From ≤ To`) y `asOf`. Los periodos pueden encimarse.

Response `200` (`basketComparisonResponse`), `ejemplos/basket-analysis-compare.json`:

```json
{
  "periodA": { "dateFrom": "2026-09-01", "dateTo": "2026-09-30", "disponible": true, "coverage": { "baskets": 100, "stores": 4 } },
  "periodB": { "dateFrom": "2026-10-01", "dateTo": "2026-10-31", "disponible": true, "coverage": { "baskets": 100, "stores": 4 } },
  "disponible": true,
  "entering": [ { "productName": "Queso panela", "frequencyA": 0.0, "frequencyB": 0.2,
                  "frequencyChange": 0.2, "averageSpendB": 55.5 } ],
  "leaving":  [ { "productName": "Quinoa orgánica", "frequencyA": 0.22, "frequencyB": 0.19,
                  "frequencyChange": -0.03, "averageSpendA": 92.0, "averageSpendB": 92.0 } ],
  "staying":  [ { "productName": "Leche entera", "frequencyA": 0.59, "frequencyB": 0.62, "…": "…" } ],
  "indicators": [ { "indicator": "averageTicket", "a": 100.64, "b": 109.83,
                    "change": 9.189999999999998, "changePercent": 9.13155802861685 }, "…" ]
}
```

- `entering`: típicos en B y no en A. `leaving`: típicos en A y no en B. `staying`:
  típicos en los dos. Mismo orden que BA-7 (por `frequencyB`).
- `frequencyA`/`frequencyB` valen `0` si el producto no se vendió en ese periodo;
  `averageSpendA`/`averageSpendB` se omiten en ese caso (no hay gasto que promediar).
- `indicators`: `averageTicket`, `productsPerBasket` y `typicalSize`. `changePercent` se
  omite si el valor de A es 0.
- Si **cualquiera** de los dos periodos no se puede publicar (D-36), `disponible: false`
  con el `motivo` del periodo que falla, y sin `entering`, `leaving`, `staying` ni
  `indicators`. Cada periodo dice su propio `disponible` y `coverage`.

## GET /v1/basket-evolution

Serie para gráfica. Query: `zoneId`, `segmentId`, `dateFrom` y `dateTo` (**obligatorios**),
`granularity` (`week` | `month`, default `month`) y `asOf`. Semanas de lunes a domingo y
meses calendario, en hora de Monterrey; el primer y el último periodo pueden quedar
parciales y lo dicen sus `periodStart`/`periodEnd`. Máximo **104 semanas** o **36
meses** → si no, `400`.

Response `200` (`basketEvolutionResponse`), `ejemplos/basket-analysis-evolution.json`:
una fila por periodo, cada una con su propia publicación (D-36):

```json
{ "granularity": "month",
  "data": [
    { "periodStart": "2026-08-01", "periodEnd": "2026-08-31", "coverage": { "baskets": 9, "stores": 3 },
      "disponible": false,
      "motivo": "La combinación zona-segmento tiene 9 transacciones (mínimo 10) en 3 tiendas (D-36, regla ambos)." },
    { "periodStart": "2026-09-01", "periodEnd": "2026-09-30", "coverage": { "baskets": 100, "stores": 4 },
      "disponible": true, "averageTicket": 100.64, "productsPerBasket": 2.13, "typicalSize": 5 },
    "…" ] }
```

Un periodo sin canastas sale con `coverage` en 0 y `disponible: false`: la serie no tiene
huecos, y el cliente no dibuja un 0 donde no hay dato.

## GET /v1/category-mix

Mezcla del gasto del grupo por categoría de producto. Query: los comunes. Lo calcula
core-process (`GET /v1/analytics/spend-by-category` con `zoneId`, `segmentId` y fechas):
este servicio lo **reutiliza** y le agrega la publicación (D-36). Mismos campos que
core-process (`share` de 0 a 100, de mayor a menor gasto; "Sin categoría" con
`categoryId` omitido).

Response `200` (`categoryMixResponse`), `ejemplos/basket-analysis-category-mix.json`.
No disponible → sin `data`. Esta ruta no acepta `asOf`: core-process no lo ofrece en
`spend-by-category`.

---

## Casos de control (pruebas del servicio)

| Caso | Entrada | Resultado esperado |
|---|---|---|
| Frontera del 20 % | 100 canastas: un producto en 20, otro en 19 | El de 20 es típico; el de 19 no (`includeAll=true` lo muestra con `typical: false`) |
| Una vez por canasta | Una canasta con "500 ml" y "1 l" del mismo producto | `basketsWithProduct` cuenta 1 |
| Grupo vacío | Zona y segmento sin canastas en el periodo | `200`, `disponible: false`, `coverage` en 0, motivo "no hay canastas…" |
| D-36 (`ambos`) | 9 transacciones / 3 tiendas; 10 / 2; 10 / 3; 9 / 2 | No; no; **sí**; no |
| D-36 (`cualquiera`) | Los mismos | No; sí; sí; no |
| Cambio de segmento | Zona reclasificada de ING_2 a ING_3 a mitad del periodo | Canastas(ING_2) + canastas(ING_3) = canastas de la zona; ninguna en los dos grupos |
| Cohorte chica | Grupo con 12 canastas en 3 tiendas | Se publica, y la frontera del 20 % se respeta con enteros (3 de 12 entra; 2 de 12 no) |
| Datos reales (CSV de 100 canastas, `cualquiera`) | Zona Valle (40 canastas, ago–sep) | Típicos: Leche entera 0.75 ($71.25), Frijol negro 0.75 ($85.00), Quinoa orgánica 0.25 ($92.00); ticket $140.19; 1.75 productos por canasta |
| Datos reales (`cualquiera`) | Zona Centro (32 canastas) | Leche entera 1.0 ($54.00), Queso panela 0.75 ($55.50); ticket $95.62 |
| Datos reales (`cualquiera`) | Zona Oriente (28 canastas) | Frijol negro 1.0 ($73.75); ticket $73.75 |
| Datos reales (`ambos`) | Cualquiera de las tres zonas | `disponible: false`: 1 tienda por zona en el seed |
| Coincide con core | Mismos filtros | `averageTicket` y `productsPerBasket` iguales a los de `/v1/analytics/*` de core-process |
| Reproducible | Misma consulta con el mismo `asOf` | Mismo cuerpo y mismo `dataVersion.sha256` |

## Bitácora y avisos

Ninguno: todas las rutas son consultas que no cambian nada, igual que las lecturas de
los demás servicios. Tampoco registra linaje en data-governance-service, porque no guarda
resultados; el origen de cada respuesta va en `dataVersion`.

## Códigos de error

| Status | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Falta `zoneId` o `segmentId` (`ejemplos/basket-analysis-error-400.json`); parámetro desconocido o mal formado; `dateFrom > dateTo`; faltan fechas en `compare` o `basket-evolution`; más de 104 semanas o 36 meses |
| 401 | `UNAUTHORIZED` | Sin token, token revocado o sin sesión en Redis |
| 403 | `FORBIDDEN` | Proveedor o Investigador de mercado |
| 404 | `NOT_FOUND` | Zona o segmento inexistente |
| 503 | `SERVICE_UNAVAILABLE` | Redis no responde; core-process, catalog o income-segmentation no responden en 3 s |

---

## Lo que consume

Por **HTTP**, reenviando el `Authorization` del usuario y el `X-Correlation-Id`; si no
responden en 3 s → `503`. No lee tablas de otros servicios.

| Servicio | Ruta | Estado | Para qué |
|---|---|---|---|
| core-process-service | `GET /v1/analytics/basket-products` | **Ruta nueva**, la implementa Leonardo (rama `feature/core-process-lecturas-analiticas`, avisado a Juan Ángel) | Canastas, tiendas y canastas con cada producto del grupo |
| core-process-service | `GET /v1/analytics/spend-by-category` | Existe | `category-mix` |
| catalog-service | `GET /v1/zones/:id` | Existe | Nombre de la zona; `404` |
| catalog-service | `GET /v1/product-categories` | Existe | Nombres de categoría |
| income-segmentation-service | `GET /v1/segments/:id` | Existe | Código y nombre del segmento; `404` |
| income-segmentation-service | `GET /v1/zones/:zoneId/classification/history` | Existe | `segment.versions` (BA-6, D-35) |

### Lectura nueva en core-process-service

`GET /v1/analytics/basket-products?zoneId=&segmentId=&dateFrom=&dateTo=&asOf=&groupBy=`:
por producto, **en cuántas canastas distintas** del grupo aparece y cuánto se gastó en él.
Agregado del servidor, sin paginar (excepción de `paginacion.md`: agregado acotado por el
catálogo). Con 500 mil transacciones, paginar las líneas una por una no es viable; el
conteo con `COUNT(DISTINCT canasta)` en Postgres sí. Es un cambio mínimo en el dominio de
core-process (solo lectura, no toca rutas existentes), como permite `CONTRIBUTING.md`; su
contrato vive en `core-process-analytics.md`.

| Parámetro | Regla |
|---|---|
| `zoneId`, `segmentId` | Obligatorios. `segmentId` es el **congelado en la canasta** (como en `/v1/baskets`) |
| `dateFrom`, `dateTo` | Opcionales, día local de Monterrey, inclusivos |
| `asOf` | Opcional: solo ventas registradas hasta ese instante. Sin él, "ahora", y se devuelve |
| `groupBy` | Opcional: `week` (lunes) o `month`. Sin él, un solo periodo |

Respuesta esperada (`ejemplos/core-process-basket-products.json`):

```json
{ "zoneId": "9792…", "segmentId": 2, "dateFrom": "2026-10-01", "dateTo": "2026-10-31",
  "groupBy": null, "timezone": "America/Monterrey", "asOf": "2026-11-25T18:20:00.000000+00:00",
  "periods": [ { "periodStart": null, "baskets": 100, "stores": 4, "totalSpend": 10983.5 } ],
  "data": [ { "periodStart": null, "productId": "a3f1…c01", "productName": "Leche entera",
              "categoryId": 2, "basketsWithProduct": 62, "spend": 3534 }, "…" ] }
```

- `periods`: un elemento por periodo (uno solo sin `groupBy`), con canastas, tiendas
  **distintas** con venta y gasto total. Son la cobertura de D-36 y la base del resumen.
- `data`: una fila por periodo y producto. `basketsWithProduct` cuenta **canastas
  distintas** (BA-2), aunque la canasta lleve varias presentaciones.
- Importes como número a 2 decimales, como los demás indicadores de core-process. XML con
  `xsd/core-process/basket-products.xsd`.

### Lo que se confirma con Pamela

No hace falta ninguna ruta nueva: segmento y clasificación con versión ya los da
income-segmentation-service, y las categorías catalog-service. Se confirma el umbral de
publicación (`PUBLICATION_RULE=ambos`, igual que en su servicio) y que la clasificación
histórica trae `segmentVersion` (BA-6).

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `PORT` | `3113` | |
| `SERVICE_NAME` | `basket-analysis-service` | Logs y health |
| `XML_NAMESPACE` | `basket-analysis/v1` | Raíz XML |
| `REDIS_URL`, `JWT_ACCESS_SECRET` | — | Sesión (plantilla) |
| `CORE_PROCESS_SERVICE_URL`, `CATALOG_SERVICE_URL`, `INCOME_SEGMENTATION_SERVICE_URL` | — | Lecturas |
| `PUBLICATION_RULE` | `ambos` | BA-5 (P-11) |

## Limitaciones conocidas

- Con el seed actual (una tienda por zona), **ningún** grupo se publica con `ambos`. Para
  demostrar el cálculo hacen falta datos con 3 o más tiendas por zona (generador del
  Parcial 3) o `PUBLICATION_RULE=cualquiera`.
- La canasta típica dice qué productos son frecuentes en el grupo; no dice que se compren
  juntos (eso es asociación, algorithms-core) ni por qué.

## Por confirmar

1. **Juan Ángel:** revisar `GET /v1/analytics/basket-products` en el PR de core-process.
2. **Juan Ángel (Matriz):** P-11 se decidió en este dominio (BA-5, `ambos`); falta
   incorporarlo a la Matriz §4, junto con la misma regla del pronóstico (DF-8).
