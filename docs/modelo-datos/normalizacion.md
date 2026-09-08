# Normalización del modelo de datos — de 1FN a 4FN

**Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista**
Documento de diseño de datos · Esquema `db/schema.sql` v3 → v4

---

## 1. Propósito

Este documento sustenta la afirmación de que el esquema relacional de la plataforma
está en **cuarta forma normal (4FN)**. No es un resumen de cambios: es el análisis que
justifica cada descomposición, con la dependencia funcional concreta que la motiva, la
anomalía que provocaba, y la verificación de que la descomposición no pierde información
ni dependencias.

Responde a la observación recibida en el Parcial 1 sobre tablas que concentraban
demasiados atributos. La revisión v3 ya había atacado esa observación separando
atributos multivaluados; este documento cubre el trabajo posterior (v4), que es de otra
naturaleza: cerrar dependencias funcionales, no partir listas.

---

## 2. Alcance y método

Se analizaron las **53 relaciones** de `db/schema.sql`. Para cada una:

1. Se determinaron sus **llaves candidatas** (no solo la llave primaria sustituta).
2. Se enumeraron las **dependencias funcionales** (DF) del dominio, incluidas las que
   la base no declaraba pero el negocio sí impone.
3. Se evaluó 2FN (dependencias parciales), 3FN (transitivas) y FNBC (todo determinante
   es llave candidata).
4. Se buscaron **dependencias multivaluadas** (DMV) no triviales para 4FN.

Una advertencia metodológica que condiciona todo lo demás: **una relación sin llave
verificable no admite análisis de forma normal**. Las formas normales son afirmaciones
sobre cómo dependen los atributos de las llaves; si no hay llave, no hay afirmación que
hacer. Por eso parte del trabajo de v4 no fue descomponer nada, sino declarar llaves que
existían en la intención del equipo pero no en la base (§6.G, §6.H, §6.J).

---

## 3. Notación

| Símbolo | Significado |
|---|---|
| `X → Y` | Dependencia funcional: `X` determina `Y` |
| `X ↠ Y` | Dependencia multivaluada |
| `R(A, B, C)` | Relación `R` con atributos `A`, `B`, `C` |
| <code>__A__</code> | Atributo que forma parte de la llave primaria |
| `R1 ∩ R2` | Atributos comunes a dos relaciones |

**Criterio de descomposición sin pérdida (Heath).** La descomposición binaria de `R` en
`R1` y `R2` es sin pérdida si `R1 ∩ R2 → R1` o `R1 ∩ R2 → R2`; es decir, si los
atributos comunes son llave de al menos una de las dos.

---

## 4. Resultado

| Esquema | Forma normal | Restricción que la limita |
|---|---|---|
| **v3** | **1FN** | Dependencia parcial en `accesibilidad_componentes` (§6.A) |
| **v4** | **4FN** | — |

Diez correcciones, agrupadas por la forma normal que restablecen:

| # | Relación | Defecto | FN restablecida |
|---|---|---|---|
| A | `accesibilidad_componentes` | Dependencia parcial `componente → peso` | 2FN |
| B | `direcciones` | `codigo_postal → municipio_id` | FNBC |
| C | `zona_clasificaciones` | `(corrida_id, cluster_valor) → segmento_ingreso_id` | FNBC |
| D | `elasticidades` | `valor → clasificacion` | 3FN |
| E | `canastas` | `valor_total → tamano` | 3FN |
| F | `precios`, `zona_clasificaciones` | Bandera `vigente` independiente de las fechas | 3FN |
| G | `indicador_valores` | Dependencias transitivas + ausencia de llave | 3FN |
| H | 4 relaciones analíticas | `UNIQUE` inoperante sobre columnas nulables | Llaves |
| I | `reglas_exclusion_asociacion` | Hecho simétrico con dos representaciones | Llaves |
| J | `precios`, `tamanos_compra` | Llave natural ausente; rangos traslapables | Llaves |

Objetos nuevos: `codigos_postales`, `corrida_clusters`, `accesibilidad_pesos`,
`tamanos_compra`.
Vistas nuevas: `v_direcciones`, `v_zona_segmento`, `v_accesibilidad_desglose`.

---

## 5. Por qué v3 estaba en 1FN

La forma normal de un esquema es la del eslabón más débil. En v3 ese eslabón era una
sola relación, y el defecto era de 2FN — el más severo del conjunto.

```
accesibilidad_componentes(__accesibilidad_id__, __componente__, valor, peso)
```

`peso` es la ponderación de cada componente en el índice compuesto de accesibilidad.
No es un dato de la zona: es un parámetro del modelo. Por lo tanto:

```
componente → peso
```

`componente` es **parte** de la llave `(accesibilidad_id, componente)`, no la llave
completa. Eso es exactamente la definición de dependencia parcial, y sitúa la relación
—y con ella todo el esquema— en 1FN.

**Anomalía concreta.** Una corrida de accesibilidad sobre 40 zonas guardaba el peso de
`'precio'` cuarenta veces. Corregir la ponderación exigía actualizar 40 filas confiando
en que ninguna quedara distinta; si una quedaba, el índice de esa zona dejaba de ser
comparable con el de las demás y nada en la base lo delataba.

---

## 6. Catálogo de violaciones corregidas

### A. `accesibilidad_componentes` — dependencia parcial (2FN)

**Antes**

```
accesibilidad_componentes(__accesibilidad_id__, __componente__, valor, peso)
    (accesibilidad_id, componente) → valor
    componente → peso                            ← parcial
```

**Después**

```
accesibilidad_componentes(__accesibilidad_id__, __componente__, valor)
accesibilidad_pesos(__corrida_id__, __componente__, peso)
```

El peso se declara una vez por corrida. Se eligió `corrida_id` y no un peso global
porque las ponderaciones son un supuesto del análisis (RF: toda corrida conserva sus
supuestos), y dos corridas pueden legítimamente ponderar distinto.

**Sin pérdida.** La reconstrucción pasa por la relación padre `accesibilidad_zona`, que
aporta `accesibilidad_id → corrida_id`. Los atributos comunes entre
`(accesibilidad_componentes ⋈ accesibilidad_zona)` y `accesibilidad_pesos` son
`{corrida_id, componente}`, que es la llave primaria de `accesibilidad_pesos`. Cumple el
criterio de Heath. Esa junta es literalmente la vista `v_accesibilidad_desglose`, que
devuelve `valor`, `peso` y su producto.

---

### B. `direcciones` — determinante que no es llave (FNBC)

**Antes**

```
direcciones(__id__, calle, numero_exterior, colonia, codigo_postal, municipio_id, …)
    codigo_postal → municipio_id                 ← determinante no candidato
```

Un código postal pertenece a un solo municipio, pero `codigo_postal` no es llave
candidata de `direcciones` (dos domicilios distintos comparten CP). Determinante que no
es llave candidata: violación de FNBC.

**Anomalía concreta.** Dos direcciones con CP `64000` podían declarar municipios
distintos, y la base no tenía cómo impedirlo. Como el análisis territorial agrupa por
municipio y por zona, una discrepancia se propagaba silenciosamente a los indicadores.

**Después**

```
codigos_postales(__codigo_postal__, municipio_id)
direcciones(__id__, calle, numero_exterior, colonia, codigo_postal → codigos_postales, …)
```

**Sin pérdida.** `R1 ∩ R2 = {codigo_postal}`, llave primaria de `codigos_postales`.
**Preserva dependencias.** `codigo_postal → municipio_id` queda declarada como la llave
de la relación nueva.

El municipio sigue siendo consultable sin cambios de significado a través de
`v_direcciones`.

**Supuesto del dominio.** Se asume la asignación CP → municipio de SEPOMEX. Existen
códigos postales que cruzan límites municipales; si el equipo llegara a necesitar uno,
el catálogo tendría que pasar a llave `(codigo_postal, municipio_id)` y `direcciones`
referenciar el par.

**Caso evaluado y descartado.** Se consideró si `colonia → codigo_postal` justificaba
otra descomposición del mismo tipo. No se aplicó: en México una colonia puede abarcar
varios CP y un CP cubre varias colonias, así que la DF no se sostiene.

---

### C. `zona_clasificaciones` — el segmento lo dicta el cluster (FNBC)

**Antes**

```
zona_clasificaciones(__id__, zona_id, segmento_ingreso_id, corrida_id, cluster_valor, …)
    (corrida_id, cluster_valor) → segmento_ingreso_id   ← determinante no candidato
```

El clustering de M05 no asigna un segmento zona por zona: asigna un segmento a cada
**cluster**, y la zona hereda el del cluster que le tocó. El determinante
`(corrida_id, cluster_valor)` no es llave candidata de la relación.

**Anomalía concreta.** Las 40 zonas del cluster 3 repetían el mismo segmento, y nada
impedía que la zona 17 declarara otro — contradiciendo el resultado del algoritmo que
supuestamente la clasificó.

**Después**

```
corrida_clusters(__corrida_id__, __cluster_valor__, segmento_ingreso_id, etiqueta)

zona_clasificaciones(__id__, zona_id, segmento_manual_id, corrida_id, cluster_valor,
                     vigente_desde, vigente_hasta, vigente, asignada_por, …)
```

Quedan dos caminos excluyentes hacia el segmento, garantizados por `CHECK`:

- **manual** → `segmento_manual_id` con `corrida_id` y `cluster_valor` nulos;
- **por cluster** → `(corrida_id, cluster_valor)` con `segmento_manual_id` nulo, y el
  segmento se lee de `corrida_clusters` mediante llave foránea compuesta.

**Sin pérdida.** `R1 ∩ R2 = {corrida_id, cluster_valor}`, llave primaria de
`corrida_clusters`.

Todo consumidor del segmento —incluido el armado de canastas en `data_retail.sql`—
consulta `v_zona_segmento`, que resuelve ambos caminos con `COALESCE`. La tabla base ya
no se consulta directamente para este dato.

---

### D. `elasticidades` — clasificación derivada del valor (3FN)

**Antes**

```
elasticidades(__id__, corrida_id, presentacion_id, zona_id, valor, clasificacion, …)
    valor → clasificacion                        ← no llave → no llave
```

La v3 ya reconocía la redundancia en un comentario y la vigilaba con un `CHECK` de
coherencia. Vigilar no es eliminar: la clasificación seguía siendo un dato que alguien
podía escribir, y el `CHECK` solo actuaba después del intento.

**Después** — columna generada:

```sql
clasificacion clasificacion_elasticidad GENERATED ALWAYS AS (
    CASE
        WHEN abs(valor) > 1.05 THEN 'elastica'::clasificacion_elasticidad
        WHEN abs(valor) < 0.95 THEN 'inelastica'::clasificacion_elasticidad
        ELSE 'unitaria'::clasificacion_elasticidad
    END
) STORED
```

Se conservan los umbrales del requerimiento (|E| > 1 elástica, |E| < 1 inelástica,
|E| ≈ 1 unitaria) con la banda de tolerancia que ya usaba v3. El `CHECK` anterior se
eliminó por innecesario. Ver §9 para el estatus formal de las columnas generadas.

---

### E. `canastas` — el tamaño se deriva del valor (3FN)

**Antes**

```
canastas(__id__, transaccion_id, …, valor_total, numero_productos, …, tamano)
    valor_total → tamano                         ← no llave → no llave
```

Peor aún, la regla de negocio RN-05 que definía la dependencia no estaba en el esquema:
vivía en un `CASE` del script de carga.

```sql
CASE WHEN t.total <  80 THEN 'chica'
     WHEN t.total < 200 THEN 'mediana'
     ELSE 'grande' END
```

**Después** — el umbral es un dato, no código:

```
tamanos_compra(__codigo__, valor_min, valor_max, descripcion)
```

La columna `canastas.tamano` desaparece; `v_canastas` resuelve el tamaño con una junta
por rango semiabierto `[valor_min, valor_max)`.

**Recuperable.** No es una descomposición por DF sino una búsqueda por rango, así que el
criterio de Heath no aplica; lo que garantiza la reconstrucción es que los rangos sean
disjuntos y cubran el dominio. Lo disjunto se declara:

```sql
CONSTRAINT excl_tamano_sin_traslape EXCLUDE USING gist (
    numrange(valor_min, valor_max, '[)') WITH &&
)
```

Sin esa restricción, dos rangos encimados duplicarían cada canasta en `v_canastas`. La
cobertura total del dominio (`valor_total >= 0`) **no** se declara: por eso la junta en
la vista es `LEFT JOIN`, de modo que un hueco en el catálogo produzca `tamano` nulo en
lugar de hacer desaparecer canastas del tablero.

**Consecuencia operativa.** Cambiar el criterio de RN-05 es un `UPDATE` de tres filas, no
un `ALTER TABLE` ni un reproceso histórico. A cambio, filtrar por tamaño es filtrar por
rango de `valor_total`; se agregó `idx_canastas_valor_total` en sustitución de
`idx_canastas_tamano`.

---

### F. `precios` y `zona_clasificaciones` — banderas contra fechas (3FN)

**Antes**, en ambas relaciones convivían una fecha de fin de vigencia y una bandera
booleana independiente:

```
precios(…, fecha_vigencia_desde, fecha_vigencia_hasta, vigente, …)
    fecha_vigencia_hasta → vigente               ← no llave → no llave
```

**Anomalía concreta.** Nada impedía un precio marcado `vigente = TRUE` con fecha de fin
en el pasado, o al revés. Como `uq_precios_vigente` (un solo precio vigente por
presentación/tienda) se apoya en esa bandera, un dato incoherente rompía la restricción
que protege la integridad de precios.

**Después.** La bandera se genera del dato del que dependía:

```sql
vigente BOOLEAN GENERATED ALWAYS AS (fecha_vigencia_hasta IS NULL) STORED
```

Se aplicó el mismo tratamiento a `zona_clasificaciones`, que recibió `vigente_hasta`
para poder sostenerlo. Cerrar un precio o una clasificación es ahora ponerle fecha de
fin; la bandera se sigue sola y el índice parcial que depende de ella no puede quedar
desalineado.

Los datos de prueba se corrigieron en consecuencia: el precio de junio de
`P-001-001 / 1 kg` pasó de `vigente = FALSE` con fecha de fin nula —una combinación que
el esquema v4 ya no admite, con razón— a `fecha_vigencia_hasta = '2026-07-31'`.

---

### G. `indicador_valores` — transitividad y ausencia de llave (3FN)

Tabla de hechos con dimensiones nulables. Presentaba dos problemas distintos.

**Dependencias transitivas.** Entre las dimensiones existen DF del dominio:

```
tienda_id   → zona_id          (una tienda pertenece a una zona)
producto_id → categoria_id     (un producto pertenece a una categoría)
```

Llenar las dos columnas de un par creaba una dependencia transitiva y admitía la
contradicción: una fila que dijera «tienda del Valle, zona Oriente». Se resolvió
obligando a elegir el grano:

```sql
CHECK (NOT (tienda_id  IS NOT NULL AND zona_id      IS NOT NULL))
CHECK (NOT (producto_id IS NOT NULL AND categoria_id IS NOT NULL))
```

**Ausencia de llave.** Fuera del UUID sustituto, la relación no tenía llave: el mismo
indicador, misma corrida, mismas dimensiones y mismo periodo podía insertarse tantas
veces como se reintentara el cálculo, y el tablero promediaría duplicados sin avisar.

```sql
ALTER TABLE indicador_valores
    ADD CONSTRAINT uq_indicador_valor UNIQUE NULLS NOT DISTINCT (
        indicador_id, corrida_id, tienda_id, zona_id, segmento_ingreso_id,
        categoria_id, producto_id, periodo_inicio, periodo_fin
    );
```

`NULLS NOT DISTINCT` (PostgreSQL 15+) es indispensable: las dimensiones no aplicables
son nulas, y bajo la semántica por omisión dos filas idénticas con nulos se consideran
distintas, de modo que la restricción no habría impedido nada.

**Caso evaluado y descartado.** Se revisó si `corrida_id → (periodo_inicio, periodo_fin)`
constituía otra transitiva, dado que `analisis_corridas` también tiene periodo. No es
DF: el periodo de la corrida es el del universo analizado, mientras que el del valor es
el de la medición, y una corrida anual puede emitir valores mensuales. Son granos
genuinamente distintos.

---

### H. Llaves inoperantes por nulos

Cuatro relaciones analíticas declaraban `UNIQUE` sobre columnas nulables. En SQL dos
nulos son distintos entre sí, de modo que la restricción **no impedía duplicados
exactamente en el caso agregado**, que es el más consultado:

| Relación | Llave declarada | Columna nulable |
|---|---|---|
| `elasticidades` | `(corrida_id, presentacion_id, zona_id)` | `zona_id` = agregado nacional |
| `sustituciones` | `(corrida_id, producto_origen_id, producto_destino_id, zona_id)` | `zona_id` |
| `limites_precio_zona` | `(zona_id, presentacion_id)` | `presentacion_id` = toda la zona |
| `escenario_resultados` | `(escenario_id, indicador_id, zona_id)` | `zona_id` |

Las cuatro pasaron a `UNIQUE NULLS NOT DISTINCT`.

---

### I. `reglas_exclusion_asociacion` — hecho simétrico, dos representaciones

«Las categorías A y B no deben asociarse» es un hecho simétrico. La restricción anterior
solo exigía `categoria_a_id <> categoria_b_id`, de modo que `(A, B)` y `(B, A)` podían
coexistir como dos filas del mismo hecho, y desactivar una dejaba la otra en pie. Se
canoniza el par:

```sql
CONSTRAINT chk_exclusion_par_canonico CHECK (categoria_a_id < categoria_b_id)
```

---

### J. Llaves naturales ausentes

Detectadas al verificar el resultado, no en el barrido inicial.

**`precios`.** `uq_precios_vigente` cubre únicamente el precio actual. El histórico
admitía dos precios distintos para la misma presentación y tienda arrancando el mismo
día. La llave existía en la intención del equipo —`data_retail.sql` la protegía con un
`NOT EXISTS` sobre exactamente esas tres columnas— pero no en la base. Se declaró
`UNIQUE (presentacion_id, tienda_id, fecha_vigencia_desde)`.

**`tamanos_compra`.** Descrito en §6.E: el `CHECK` de rango valida cada fila por
separado; la restricción de exclusión valida el conjunto.

---

## 7. Verificación de 4FN

Una dependencia multivaluada no trivial requiere que, fuera del determinante, queden al
menos dos atributos independientes entre sí. En consecuencia, **solo las relaciones
todo-llave** (aquellas cuya llave primaria cubre todos sus atributos) pueden violar 4FN
sin violar antes FNBC. En el esquema v4 hay exactamente dos.

**`analisis_corrida_filtros(__corrida_id__, __dimension__, __referencia_id__)`**

La DMV candidata sería `corrida_id ↠ dimension`. Exigiría que, si una corrida contiene
`('zona', Z1)` y `('categoria', C1)`, también contuviera `('zona', C1)` y
`('categoria', Z1)`. No las contiene: cada `referencia_id` pertenece a su dimensión. No
hay producto cruz y por tanto no hay DMV.

Vale la pena notar que esta relación ya está en la forma que 4FN prescribe: los filtros
se guardan como pares dimensión-referencia independientes, no como el producto cruz de
las combinaciones efectivas que el análisis recorre.

**`regla_asociacion_items(__regla_id__, __producto_id__, __lado__)`**

La DMV candidata sería `regla_id ↠ producto_id`. Exigiría que cada producto de la regla
apareciera en ambos lados. Ocurre lo contrario: en una regla X → Y los conjuntos
antecedente y consecuente son disjuntos por definición.

Las 51 relaciones restantes tienen al menos un atributo no llave, y en todas ellas todo
determinante es llave candidata (FNBC), condición verificada relación por relación en
§6. **El esquema está en 4FN.**

---

## 8. Denormalización deliberada

Lo siguiente **no** son violaciones de forma normal, y conviene poder explicarlo: las
formas normales miden cómo dependen los atributos de la llave de **su propia relación**.
La redundancia entre relaciones distintas es otra categoría de decisión.

| Elemento | Por qué no es violación |
|---|---|
| `canastas.zona_id`, `canastas.segmento_ingreso_id` | Es la clasificación **vigente al construir la canasta**. Reclasificar una zona hoy no debe reescribir el análisis de meses pasados: es un hecho histórico distinto del actual, no una copia. |
| `canastas.valor_total`, `numero_productos`, `unidades_totales`, `productos_basicos` | Agregados materializados a propósito. Dependen por completo de `transaccion_id`, que es llave candidata de `canastas`. |
| `transacciones.total` | Igual: agregado de sus detalles, dependiente de la llave. |
| `importaciones.filas_totales`, `filas_validas`, `filas_con_error` | Resumen de la carga, mostrado al usuario al confirmar. |
| `auditoria.rol_id` | Rol con el que actuaba el usuario **en el instante del evento**. El rol puede cambiar después, así que no es derivable de `usuarios` y no constituye transitiva. |
| `productos.estatus` | Estado actual; el historial completo de decisiones vive en `producto_revisiones`. |
| `transacciones_detalle.precio_unitario` | Precio congelado al momento de la venta. `precios` cambia y el histórico de ventas no se reescribe. |

---

## 9. Salvedades formales

**Columnas generadas.** El esquema usa cinco columnas `GENERATED ALWAYS … STORED`:
`precios.vigente`, `zona_clasificaciones.vigente`, `elasticidades.clasificacion`,
`transacciones_detalle.subtotal` y `escenario_resultados.variacion_pct`.

Leída al pie de la letra la lista física de columnas, `fecha_vigencia_hasta → vigente`
**es** una dependencia de atributo no llave sobre atributo no llave. La postura de este
diseño es que una columna generada no constituye información independiente: no puede
escribirse, la mantiene el motor, y por lo tanto **no puede producir la anomalía de
actualización que las formas normales existen para prevenir**. Es redundancia controlada
por el gestor, no por la aplicación.

La alternativa formalmente estricta sería expresarlas como vistas. Se descartó porque
`uq_precios_vigente` —el índice parcial que garantiza un solo precio vigente por
presentación y tienda— necesita una columna real sobre la cual indexar.

**Tabla de staging.** `importacion_filas` guarda el texto crudo del CSV (`sku_origen`,
`tienda_origen`) junto a las entidades que resolvió (`presentacion_id`, `tienda_id`).
Técnicamente `sku_origen → presentacion_id` viola FNBC. Se acepta a conciencia: la
función de esa tabla es ser copia fiel de un artefacto externo más el veredicto de su
validación, y normalizarla destruiría justamente la evidencia que permite señalarle al
usuario qué celda de su archivo falló.

---

## 10. Restricciones no expresables de forma declarativa

Quedan dos reglas que no son problemas de normalización, sino de integridad no
declarativa. Requieren disparador y están anotadas en `schema.sql`:

1. Que las dimensiones llenadas en `indicador_valores` correspondan al `ambito`
   declarado del indicador en su catálogo.
2. Que los pesos de `accesibilidad_pesos` de una misma corrida sumen 1.

---

## 11. Impacto en el código

| Componente | Cambio |
|---|---|
| `db/schema.sql` | Esquema v4. Fuente de verdad; se ejecuta desde `docker-entrypoint-initdb.d`. |
| `db/data_retail.sql` | Datos de prueba alineados: catálogo de CP, catálogo de tamaños, `segmento_manual_id`, fechas de fin de vigencia en lugar de banderas. |
| `api/src/entities/codigo-postal.entity.ts` | Entidad nueva. |
| `api/src/entities/direccion.entity.ts` | Sin `municipio_id`; el municipio se lee por `codigoPostalRef.municipio`. |
| `api/src/config/database.config.ts` | Registro de entidades completado (ver nota abajo). |

Los módulos analíticos (`accessibility`, `analytics`, `baskets`, `elasticity`) todavía
son stubs sin acceso a datos, de modo que ninguna consulta existente se rompió.

**Nota al margen, encontrada durante este trabajo.** `DireccionEntity`,
`ProductoPresentacionEntity`, `UnidadMedidaEntity` y `ProductoRevisionEntity` no estaban
registradas en `database.config.ts` pese a ser referenciadas con relaciones *eager*
desde `TiendaEntity` y `ProductoEntity`; TypeORM aborta al resolver el metadata. Se
registraron, porque la cadena `Tienda → Direccion → CodigoPostal` que introduce este
cambio la alarga.

**Puesta en marcha.** `schema.sql` construye la base desde cero: arranca borrando todos
sus objetos y los vuelve a crear, todo dentro de una sola transacción. Se puede
reejecutar sobre una base ya inicializada sin destruir el volumen:

```bash
docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U postgres -d retail_analytics < db/schema.sql
docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U postgres -d retail_analytics < db/data_retail.sql
```

En un volumen limpio no hace falta nada de esto: Docker ejecuta ambos archivos en orden
desde `docker-entrypoint-initdb.d`.

No es un script de migración: no conserva datos ni detecta qué cambió respecto a la
versión anterior. Para el entorno de desarrollo del equipo es lo adecuado; cuando haya
datos que no se puedan perder, el mecanismo tendrá que ser otro.

**Estado de verificación.** El DDL fue revisado estáticamente (orden de declaración,
resolución de todas las referencias, correspondencia de cada `INSERT` del seed con las
columnas del esquema, ausencia de escrituras sobre columnas generadas, rangos del
catálogo sin traslape). **No se ejecutó contra un motor PostgreSQL**: el equipo de
trabajo donde se produjo este cambio no tenía Docker ni PostgreSQL disponibles. Las dos
construcciones menos habituales —`EXCLUDE USING gist` sobre `numrange` y
`GENERATED ALWAYS` sobre un tipo enumerado— son válidas en PostgreSQL 16 según su
sintaxis, pero no están probadas. Es lo primero que conviene confirmar al levantar el
entorno.

---

## 12. Trazabilidad

| Regla / requerimiento | Dónde vive ahora |
|---|---|
| RN-01 · segmentos por ingreso | `segmentos_ingreso`, `corrida_clusters` |
| RN-02 · el ingreso se asigna por zona agregada | `zona_clasificaciones`, `v_zona_segmento` |
| RN-03 · una transacción, una canasta | `canastas.transaccion_id UNIQUE` |
| RN-05 · tamaño de compra | `tamanos_compra` (antes: un `CASE` en el script de carga) |
| RN-06 · variación de precios por zona | `precios`, `limites_precio_zona`, `v_variacion_precios` |
| RN-10 · asociaciones espurias | `reglas_exclusion_asociacion` |
| RF-15 · corrida de Apriori reproducible | `analisis_corridas` + `_parametros` + `_supuestos` + `_filtros` |
| RF-35 · presentaciones como tabla | `producto_presentaciones` (v3) |
| M12 · accesibilidad como índice compuesto | `accesibilidad_zona`, `accesibilidad_componentes`, `accesibilidad_pesos`, `v_accesibilidad_desglose` |
