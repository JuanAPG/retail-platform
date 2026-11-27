# Ficha del algoritmo complejo (Parcial 3)

Dos algoritmos, en el orden que pide la guía: primero **reglas de asociación** (Apriori y FP-Growth,
`algorithms-core`, M10) como primera evidencia, y después el **pronóstico de demanda** (Holt-Winters,
`demand-forecast-service`, T-13). Cada uno con problema, variables y unidades, entradas y salidas,
restricciones, pseudocódigo, complejidad, casos de control, métricas, limitaciones y tiempos medidos.

Las mediciones se pueden repetir con los mismos datos (generador con semilla, `db/README-generador.md`):

| Qué | Comando | Salida |
|---|---|---|
| Asociación por volumen y umbral | `cd services/algorithms-core && npm run medir:asociacion -- --datos ../../db/generados/<n> --salida <archivo>` | `<archivo>.md` y `.json` |
| Pronóstico por volumen | `cd services/demand-forecast-service && python scripts/medir_pronostico.py --datos ../../db/generados/<n> --salida <archivo>` (en la imagen del servicio) | `<archivo>.md` y `.json` |

**Dónde se midió.** Equipo de desarrollo: Windows 11, Node 22.11 y Python 3.12 (imagen del servicio).
Los scripts llaman a las **funciones del servicio** sobre las ventas de los CSV del generador 1.3.0,
sin base ni HTTP, para aislar el costo del algoritmo. Aparte se midió una corrida de punta a punta
por la API local. No son tiempos de staging; la carga en staging está en `carga/README.md`.

---

## 1. Reglas de asociación: Apriori y FP-Growth (M10, D2)

### Problema

¿Qué productos se compran juntos? En las canastas de un periodo (y, opcionalmente, de una tienda,
una zona o un segmento de ingreso de la zona, RN-02), encontrar las reglas *A → B*: "las canastas que
llevan A también suelen llevar B", con su soporte, confianza y lift. Alimenta las recomendaciones de
la cadena de negocio (ASOCIACIONES → … → RECOMENDACIONES). Es co-ocurrencia: **no prueba causalidad**.

Hay dos implementaciones con la misma firma (D2, RF-14). Comparten el paso final (`buildResult`:
reglas y orden), así que con los mismos datos y umbrales dan **los mismos itemsets y reglas en el
mismo orden**. Solo cambia cómo encuentran los itemsets frecuentes.

### Variables y unidades

| Variable | Qué es | Unidad |
|---|---|---|
| Canasta | Productos de una transacción (una canasta = una transacción, RN-03) | conjunto de productos |
| Producto | Producto del catálogo. Dos presentaciones del mismo producto cuentan **una vez** por canasta | id |
| N | Canastas consideradas | canastas |
| P | Productos distintos en las canastas | productos |
| L̄ | Productos promedio por canasta | productos/canasta |
| Soporte(X) | Canastas que contienen todo X / N | fracción en (0, 1] |
| Confianza(A → B) | soporte(A ∪ B) / soporte(A) | fracción en (0, 1] |
| Lift(A → B) | confianza / soporte(B) | razón; > 1 = asociación positiva |
| `minSupport`, `minConfidence` | Umbrales, comparados con `>=` (D-17) | fracción en (0, 1] |
| `maxItemsetSize` | Tamaño máximo de un itemset | 2 a 4, default 3 |

### Entradas y salidas

- **Entrada** (`POST /v1/association/apriori/run` o `/fpgrowth/run`, contrato `docs/contratos/algorithms-core.md`):
  `minSupport` y `minConfidence` obligatorios, sin default oculto; `maxItemsetSize`; filtros opcionales
  `storeId`, `zoneId`, `segmentId`, `dateFrom` y `dateTo` (días en hora local, `dateTo` inclusivo).
- **Salida:** las reglas, cada una con antecedente y consecuente (conjuntos de productos), `support`,
  `confidence`, `lift` y `transactionCount`. Se ordenan por confianza, lift y soporte descendentes, y
  luego por los ids (orden total: dos corridas iguales dan el mismo orden).
- **Corrida guardada en MongoDB** (D3): parámetros, supuestos, filtros, periodo, usuario, reglas y la
  **foto de los datos** (D-15): SHA-256 de las canastas como conjuntos ordenados, más su número. Con
  eso la corrida se puede reproducir.

### Restricciones

- **D-17:** soporte y confianza en (0, 1]; un umbral se cumple con `>=`. Para que `0.1 × 30` no exija 4
  canastas en vez de 3, se compara con una tolerancia de 1e-9.
- **D-15:** determinista. En FP-Growth, el orden de los productos dentro del árbol desempata por id;
  así la forma del árbol no depende del orden en que llegan las canastas.
- **RN-02:** el segmento es el de la **zona** de la compra; nunca se infiere el ingreso de una persona.
- **RN-10:** las reglas entre pares de categorías excluidos se descartan y se cuentan en
  `reglas_excluidas_rn10`. La lista de exclusiones sigue pendiente (PR-4).

### Pseudocódigo

```
APRIORI(canastas, minSupport, minConfidence, maxK):
  T ← cada canasta como conjunto (un producto una vez)
  minCount ← máx(1, ⌈minSupport · |T| − ε⌉)
  F1 ← productos con conteo ≥ minCount                                   (1 pasada sobre T)
  para k = 2 .. maxK mientras |F(k−1)| > 1:
     C ← unir pares de F(k−1) que comparten los primeros k−2 productos
     C ← quitar de C los candidatos con algún subconjunto de tamaño k−1 fuera de F(k−1)   (poda)
     para cada canasta t con |t| ≥ k: para cada c en C: si c ⊆ t entonces conteo[c]++      (1 pasada)
     F(k) ← { c ∈ C : conteo[c] ≥ minCount }
  devolver REGLAS(F1 ∪ … ∪ F(maxK))

FP-GROWTH(canastas, minSupport, minConfidence, maxK):
  minCount ← igual que arriba
  MINAR(caminos = canastas con peso 1, sufijo = ∅)
  devolver REGLAS(itemsets encontrados)

  MINAR(caminos, sufijo):
     contar productos en caminos; orden ← frecuentes por conteo desc. y, en empate, por id
     árbol ← insertar cada camino (solo frecuentes, en ese orden) compartiendo prefijos
     para cada producto x del árbol, con todos sus nodos:
        registrar {x} ∪ sufijo con la suma de los conteos de sus nodos
        si |{x} ∪ sufijo| < maxK: MINAR(prefijos de los nodos de x con su conteo, {x} ∪ sufijo)

REGLAS(itemsets):  (común, `buildResult`)
  para cada itemset I con |I| ≥ 2, para cada división A ∪ B = I con A, B ≠ ∅:
     si conteo(I) ≥ minConfidence · conteo(A): regla A → B con soporte, confianza y lift
  ordenar por confianza, lift, soporte desc. y por ids
```

### Complejidad (bajo los supuestos del código)

Notación: N canastas, L̄ productos por canasta, P productos, `C_k` candidatos y `F_k` frecuentes de
tamaño k, K = `maxItemsetSize`.

| | Apriori | FP-Growth |
|---|---|---|
| Tiempo | O(N·L̄) del nivel 1 + Σₖ [O(F_{k−1}²·k²) para generar y podar + **O(C_k · N_k · k)** para contar], con N_k = canastas con ≥ k productos | O(N·L̄·log L̄) por construir el árbol inicial (conteo + inserción ordenada) + Σ árboles condicionales O(tamaño de su base) |
| Espacio | O(N·L̄) para las canastas como conjuntos + O(Σ C_k·k) para los candidatos | O(nodos del árbol) ≤ O(N·L̄), mucho menor si comparten prefijos; la recursión tiene profundidad ≤ K |
| Pasadas sobre los datos | Una por nivel (K) | Dos sobre los datos originales; el resto, sobre árboles condicionales |
| Árboles condicionales | — | 1 + (itemsets frecuentes de tamaño < K): con 500k y soporte 0.005, 26 + 278 + 1 = 305, medido |
| Reglas | O(Σ_I (2^{|I|} − 2)): con K = 3, como mucho 6 por itemset | igual |

**Lo que domina en la práctica.** En Apriori domina contar candidatos: **C_k × N**. Esas "pruebas de
contención" crecen linealmente con el volumen y con cuántos candidatos deja pasar el soporte. En
FP-Growth domina construir los árboles, cuyo tamaño crece con la variedad de las canastas y no con
su número: con 500k canastas, el árbol inicial tiene unos 104 mil nodos para 1.87 millones de
productos en canasta (18 veces menos).

**Tope por el catálogo.** C₂ ≤ C(P, 2) y C₃ ≤ C(P, 3). El generador tiene P = 26 productos: como
mucho 325 pares y 2,600 tríos. Con un catálogo real de miles de productos ese tope desaparece, y los
candidatos de Apriori pueden crecer cuadráticamente con los productos frecuentes. Ese es el caso en
que FP-Growth está pensado para ganar.

### Volumen y umbrales que disparan candidatos y reglas (medido)

Mismos datos para los dos algoritmos y la misma foto. `maxItemsetSize` 3. Las reglas son las que
pasan cada confianza. "Iguales" = mismos itemsets y reglas en el mismo orden.

**500,000 canastas** (1,868,901 productos en canasta, 26 productos, foto `6046e865…`):

| Soporte | Conteo mín. | Frecuentes 1/2/3 | Candidatos 2/3 (podados en 3) | Pruebas de contención | Nodos árbol inicial / total (árboles) | Reglas ≥ 0.3/0.5/0.8 | Apriori ms | FP-Growth ms | Iguales |
|---|---|---|---|---|---|---|---|---|---|
| 0.2 | 100,000 | 4/0/0 | 6/0 (0) | 2.8 M | 15 / 15 (5) | 0/0/0 | 272 | 387 | sí |
| 0.1 | 50,000 | 22/2/0 | 231/0 (0) | 107.6 M | 66,576 / 66,578 (25) | 4/3/0 | 1,807 | 1,018 | sí |
| 0.05 | 25,000 | 24/4/0 | 276/1 (1) | 129.0 M | 91,386 / 91,391 (29) | 4/3/0 | 2,309 | 1,155 | sí |
| 0.02 | 10,000 | 26/137/7 | 325/447 (134) | 327.7 M | 104,361 / 109,019 (164) | 18/14/0 | 4,339 | 1,284 | sí |
| 0.01 | 5,000 | 26/262/42 | 325/1,777 (40) | 852.1 M | 104,361 / 187,391 (289) | 88/65/0 | 9,290 | 1,333 | sí |
| 0.005 | 2,500 | 26/278/125 | 325/2,005 (13) | 942.0 M | 104,361 / 203,205 (305) | 92/67/0 | 9,698 | 1,393 | sí |

**Por volumen** (soporte 0.01 / 0.005):

| Canastas | Productos en canasta | Apriori ms | FP-Growth ms | Ventaja de FP-Growth | Pruebas de contención (0.01) |
|---|---|---|---|---|---|
| 10,000 | 38,975 | 321 / 331 | 32 / 35 | 10× | 18.6 M |
| 100,000 | 375,384 | 1,826 / 2,024 | 274 / 260 | 7–8× | 180.4 M |
| 500,000 | 1,868,901 | 9,290 / 9,698 | 1,333 / 1,393 | 7× | 852.1 M |

Lo que muestran:

- **El soporte es el umbral que dispara todo.** Hasta 0.05 casi nada pasa al nivel 2. Al bajar a
  0.02, los pares frecuentes pasan de 4 a 137 y los tríos candidatos de 1 a 447. Con 0.01 los tríos
  candidatos llegan a 1,777 y las reglas a 88 (con confianza 0.3). Debajo de 0.01 el tope del
  catálogo frena el crecimiento.
- **La confianza no cambia el costo:** solo filtra reglas al final. Con 0.8 no sale ninguna regla con
  estos datos (las asociaciones sembradas son de 0.45 y 0.60).
- **La poda de Apriori funciona donde hay candidatos:** con 0.02 descarta 134 tríos sin contarlos.
- **Apriori crece casi linealmente con N:** de 10k a 500k (50 veces más canastas), 29 veces más
  tiempo con soporte 0.01. Su costo sigue a las pruebas de contención.
- **FP-Growth gana desde que hay candidatos que contar**, hasta 10 veces con 10k. Con soporte alto
  (0.2), donde casi no hay candidatos, Apriori es más rápido: construir el árbol cuesta más que
  contar 6 pares.
- **Memoria** (incremento del heap durante el minado): unos 120–150 MiB con 500k en ambos,
  dominados por tener las canastas en memoria.

**De punta a punta por la API local** (10,006 canastas, soporte 0.01, confianza 0.3, mediana de 3
corridas): Apriori 720 ms y FP-Growth 359 ms, las mismas 104 reglas en el mismo orden y **la misma
foto en Mongo** (`5aedd3fe…`, 10,006 canastas). El algoritmo es 321 ms y 32 ms de eso; el resto
(~350–400 ms) es leer las canastas de Postgres y guardar la corrida.

### Casos de control

| Caso | Dónde | Resultado |
|---|---|---|
| Ejemplo de libro (Tan, Steinbach y Kumar), 5 canastas | `apriori.spec.ts`, `estadisticas.spec.ts` | Con soporte 0.6: 8 reglas y {cerveza} → {pañal} con confianza 1 y lift 1.25. Candidatos 6/6/1, frecuentes 4/4/0 y 34 pruebas de contención, calculados a mano. |
| Poda de Apriori | `estadisticas.spec.ts` | Con soporte 0.4 se poda {leche, pan, refresco} porque {pan, refresco} no es frecuente. |
| Compresión del árbol FP | `estadisticas.spec.ts` | Los 15 productos frecuentes del ejemplo quedan en 9 nodos. |
| Misma salida en los dos (D2) | `fpgrowth.spec.ts` y la medición | Iguales en el ejemplo de libro, en canastas aleatorias con semilla y en los 18 casos medidos (3 volúmenes × 6 soportes). |
| Reproducible (D-15) | `apriori.spec.ts`, `fpgrowth.spec.ts`, `medir-asociacion.spec.ts` | Las mismas canastas en otro orden dan el mismo resultado. La foto del script es igual a la del servicio. |
| Asociaciones sembradas por el generador | generador + API | {frijol} → {tortilla}: confianza 0.65 y lift 2.51 (sembrada 0.60). {leche} → {cereal}: confianza 0.51 y lift 2.23 (sembrada 0.45). |

### Métricas

Soporte, confianza y lift por regla. Por corrida: canastas consideradas, `reglas_generadas`,
`reglas_excluidas_rn10` y la foto.

### Limitaciones

- **Co-ocurrencia, no causalidad:** una regla dice que se compran juntos, no que uno cause al otro.
- **Itemsets de hasta 4 productos** (default 3): una combinación más larga no se busca.
- **Una corrida sin filtros mezcla zonas y segmentos.** Para recomendar por zona hay que filtrar por
  `zoneId` o `segmentId`; las asociaciones pueden ser distintas por ingreso.
- **Umbrales sin default:** quien corre elige el soporte. Por la tabla de arriba, con este catálogo
  conviene 0.01–0.02 para ver tríos sin quedar en el tope.
- **Los datos se leen todavía con SQL** desde `src/fuente-datos/`; la migración a HTTP es ALG-11. El
  tiempo de leer las canastas (~350 ms con 10k) se moverá a core-process.
- **Plan de consulta:** la lectura de canastas por zona y segmento usa `idx_canastas_fecha` y no
  `idx_canastas_zona_fecha`, y recorre `transacciones` entera por un filtro de tienda que no se usa
  (`carga/README.md`, planes). Es la mejora pendiente de la lectura, no del algoritmo.
- **Los tiempos son de un equipo de desarrollo**, con las canastas ya en memoria.

---

## 2. Pronóstico de demanda: Holt-Winters semanal (T-13, D-40)

### Problema

¿Cuánto se va a vender de un producto en las próximas 8 semanas, en una zona o en todas? Se ajusta
un Holt-Winters a la serie semanal histórica, se valida con las últimas 4 semanas reservadas (MAPE) y
se pronostica con intervalos de 80 % y 95 %. Lo usan la planeación y las recomendaciones; las
existencias reales son de availability-service.

### Variables y unidades

| Variable | Qué es | Unidad |
|---|---|---|
| Semana | Lunes a domingo en America/Monterrey; `weekStart` es el lunes (DF-1) | fecha |
| y_t | Venta del producto en la semana t, en la **unidad base** de su tipo: Σ cantidad × contenido × factorBase (DF-2) | kg, l o pza |
| n | Semanas de historia, de la primera con venta a la última semana completa | semanas |
| m | Periodo estacional (`SEASONAL_PERIOD`) | 4 semanas (≈ un mes) |
| α, β, γ | Suavizamiento de nivel, tendencia y estacionalidad (los estima el modelo) | [0, 1] |
| h | Horizonte | 8 semanas |
| MAPE | Error porcentual medio absoluto en las 4 semanas reservadas con venta > 0 | % |
| Intervalos | Límites de 80 % y 95 % | la unidad base |

### Entradas y salidas

- **Entrada** (`POST /v1/forecast/run`, contrato `docs/contratos/demand-forecast-service.md`):
  `productId` obligatorio; `zoneId`, `dateFrom` y `dateTo` opcionales. La ventana se ajusta a
  semanas completas.
- **Datos que lee:** ventas semanales por presentación desde core-process
  (`GET /v1/analytics/weekly-sales`) y presentaciones con su unidad desde catalog-service.
- **Salida:** `validation` (semanas de ajuste, MAPE y las 4 semanas reservadas, real contra
  pronóstico), `forecast` (8 semanas con `lower80/upper80`, `lower95/upper95` y `clipped`), `model`
  (α, β, γ, AIC y versión de statsmodels), `limitations`, y `disponible` con `motivo` (D-36).
- **Corrida guardada en Mongo** (D-47) con la serie exacta, su SHA-256, los parámetros y `durationMs`
  (DF-9). `POST /v1/forecast/runs/:id/replay` recalcula y dice si salió idéntico.

### Restricciones (DF-1 a DF-9 del contrato)

- **DF-2:** se suman presentaciones del mismo tipo de unidad: 3 × 500 ml + 1 × 1 l = 2.5 l. Si el
  producto se vende en tipos distintos (pieza y masa), no se suma y responde 422.
- **DF-3:** una semana sin ventas en medio cuenta como 0 y queda marcada `filled`.
- **DF-4 (D-40):** menos de 12 semanas → 422. Frontera: 11 → 422 y 12 → 201.
- **DF-5:** statsmodels necesita dos ciclos completos para estimar la estacionalidad: n − 4 ≥ 2m.
- **DF-6:** el ajuste de validación **no ve** las 4 semanas reservadas. El MAPE excluye las reservadas
  con venta 0 y las cuenta.
- **DF-7:** el ajuste final usa toda la historia. Los intervalos son **analíticos**, no simulados:
  misma entrada, mismo intervalo. Un límite inferior negativo se recorta a 0 y se marca.
- **DF-8 (D-36):** con menos de 10 transacciones o menos de 3 tiendas, la corrida sale
  `disponible:false` con motivo y sin ningún número.

### Pseudocódigo

```
PRONOSTICO(producto, zona, ventana):
  ventas ← ventas semanales por presentación (core-process)
  si las presentaciones vendidas son de más de un tipo de unidad: 422 (DF-2)
  y ← por semana, Σ cantidad × contenido × factorBase              (unidad base)
  serie ← de la primera semana con venta a la última semana completa; huecos en 0 (DF-3)
  si D-36 no se cumple (transacciones < 10 o tiendas < 3): disponible:false con motivo
  si n < 12 o n − 4 < 2m: 422 (DF-4, DF-5)
  M_val ← ETS(A,A,A, m).ajustar(y[1 .. n−4])                        (no ve las 4 reservadas)
  ŷ ← M_val.pronosticar(4);  MAPE ← media(|y − ŷ| / y) · 100 sobre las reservadas con y > 0
  M ← ETS(A,A,A, m).ajustar(y[1 .. n])
  para h = 1..8: media_h, intervalo80_h, intervalo95_h ← M.predicción(h)   (analítica)
                 recortar a 0 los límites inferiores negativos
  devolver validación, pronóstico, parámetros (α, β, γ, AIC), limitaciones
```

ETS(A,A,A) actualiza en cada semana nivel ℓ, tendencia b y estacionalidad s:
`ℓ_t = α(y_t − s_{t−m}) + (1−α)(ℓ_{t−1} + b_{t−1})`, `b_t = β(ℓ_t − ℓ_{t−1}) + (1−β)b_{t−1}`,
`s_t = γ(y_t − ℓ_t) + (1−γ)s_{t−m}`. El pronóstico a h semanas es `ℓ_n + h·b_n + s_{n+h−m}`.
statsmodels estima α, β, γ y los estados iniciales por máxima verosimilitud.

### Complejidad (bajo los supuestos del código)

Notación: n semanas (≤ 52 en estos datos), m = 4, h = 8, I iteraciones del optimizador de
statsmodels, L líneas de venta en la ventana.

| Paso | Tiempo | Espacio |
|---|---|---|
| Juntar las ventas por semana y presentación (core-process, SQL) | O(L) | O(n × presentaciones) |
| Convertir a la unidad base y rellenar huecos | O(n) | O(n) |
| Ajustar ETS (2 veces: validación y final) | O(I · n) por ajuste: cada evaluación de la verosimilitud recorre la serie una vez | O(n + m) |
| Pronóstico e intervalos analíticos | O(h) | O(h) |
| **Una corrida** | **O(L) + O(I · n)** | O(n) |

El costo del modelo **no depende del número de ventas, sino de las semanas**. El volumen solo pesa al
juntar las ventas, y eso lo hace core-process. Con la historia acotada a 52 semanas, el ajuste es
prácticamente constante por serie.

### Tiempos medidos

Todas las series producto × zona, y producto en todas las zonas, del generador 1.3.0 (52 semanas,
hasta el 22 de noviembre de 2026):

| Ventas | Series | Ajustadas / 422 | No publicables (D-36) | ms por corrida, p50 / p95 / máx | MAPE % p50 / p90 / máx | Todas las series | Juntar ventas por semana (desde CSV) |
|---|---|---|---|---|---|---|---|
| 10,000 | 121 | 110 / 11 | 18 | 48 / 69 / 172 | 7.6 / 16.3 / 101.5 | 5.7 s | 0.8 s |
| 100,000 | 117 | 109 / 8 | 14 | 68 / 114 / 200 | 6.9 / 13.1 / 17.9 | 7.7 s | 7.3 s |
| 500,000 | 120 | 111 / 9 | 17 | 77 / 124 / 167 | 7.0 / 13.8 / 111.2 | 8.6 s | 34.0 s |

"ms por corrida" es la validación más el ajuste final y el pronóstico. Al pasar de 10k a 500k
ventas, el tiempo por corrida sube poco (48 → 77 ms en el p50); juntar las ventas crece linealmente
(0.8 → 34 s).

Los MAPE de alrededor de 100 % son todos de series **no publicables** (2 a 8 transacciones en 1 o 2
tiendas). En el servicio, D-36 las corta antes del modelo con `disponible:false`; la tabla las incluye
porque el script ajusta todo. **Solo las publicables**, que son las que ve el usuario (95 series con
MAPE en cada volumen):

| Ventas | MAPE % p50 | p90 | Máx (serie) |
|---|---|---|---|
| 10,000 | 7.2 | 13.9 | 48.9 (refresco en Zona Oriente) |
| 100,000 | 6.9 | 12.7 | 17.9 (agua de coco, 12 semanas, Zona Centro) |
| 500,000 | 7.0 | 12.7 | 17.7 (agua de coco, Zona Centro) |

Motivos de 422 con 10k: 4 series con 11 semanas (producto de lanzamiento, por zona), 3 con 4
semanas (zona chica) y 4 con unidades mezcladas (huevo).

### Casos de control

Los siembra el generador (`manifiesto.json`, controles); salen igual en los tres volúmenes:

| Control | Esperado | Medido |
|---|---|---|
| `D-40-patron`: azúcar en Zona Valle, serie exacta `40 + t + [8, 0, −5, −3][t mod 4]` con precio fijo | MAPE ≈ 0 | 52 semanas, 201, **MAPE 0.0** |
| `D-40-historia-11`: bebida energética, 11 semanas | 422 | 422 "Hay 11 semanas de historia; el pronóstico necesita al menos 12 (D-40)" |
| `D-40-historia-12`: agua de coco, 12 semanas | 201 | 201, MAPE 13–15 % |
| `DF-2-unidades-mezcladas`: huevo en `12 pza` y `1 kg` | 422 | 422 "tipos de unidad distintos (masa, pieza)" |

Pruebas: `tests/test_modelo.py` y `tests/test_dominio.py` del servicio, más
`tests/test_medir_pronostico.py` para el armado de la serie del script.

### Métricas

MAPE en las 4 semanas reservadas (con cuántas se usaron y cuántas se excluyeron por venta 0),
intervalos de 80 % y 95 %, α, β, γ y AIC del ajuste final, y `durationMs` de la corrida.

### Limitaciones

- **Estacionalidad de 4 semanas (mensual).** La anual (52 semanas) necesitaría al menos 108 semanas
  de historia; el generador da 52. Se dice en `limitations`.
- **Una semana sin ventas vale 0.** Si la falta de venta fue por un faltante de inventario (D-38), el
  modelo lo toma como demanda cero.
- **El MAPE no existe** si las 4 semanas reservadas tienen venta 0 (divide entre la venta real): sale
  `null` con motivo.
- **Pocas semanas:** con menos de 16 semanas de ajuste, el modelo estima 9 parámetros con muy pocos
  datos; el pronóstico es frágil y se avisa.
- **Los intervalos analíticos suponen errores aditivos normales.** Un límite inferior negativo se
  recorta a 0 y se marca `clipped`.
- **La serie es por producto, no por presentación** (D-06, DF-2). Un producto vendido en pieza y en
  masa no se pronostica.
- **Los tiempos son de un equipo de desarrollo**, con las ventas leídas de CSV; en el servicio, juntar
  las ventas lo hace core-process por HTTP.
