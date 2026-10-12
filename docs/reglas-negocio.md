# Reglas de negocio (RN-01 a RN-15)

> Fuente: *S0 Reglas de Negocio* (Pamela Rodríguez de la Rosa, 01-sep-2026).
> El texto de cada regla es **literal**. La sección **Estado vigente** es agregada:
> indica si la regla aplica tal cual, si una decisión posterior la reemplaza, o si
> choca con algo y está pendiente.
>
> Precedencia: decisiones de negocio (`docs/matriz-perfiles-permisos.md` §4) >
> Matriz > RF (`docs/requerimientos.md`) > **este archivo** > contratos.
> Estas reglas son anteriores a las decisiones D-xx; cuando chocan, gana la decisión.
>
> Estados: **Vigente** · **Sustituida por D-xx** · **PENDIENTE (Px)** (no se
> implementa ni se reporta como defecto de código) · **Fuera del Parcial 2**.

## Resumen

| RN | Tema | Estado |
|---|---|---|
| RN-01 | Definición de segmentos de ingreso | Vigente parcial · ver nota |
| RN-02 | Agrupación geográfica por clustering | Vigente · datos de prueba con 3 municipios |
| RN-03 | Umbrales de agrupación de transacciones | Fuera del Parcial 2 (umbral calculado) |
| RN-04 | Canasta básica de referencia, stock | Vigente parcial · D-03 |
| RN-05 | Representatividad por segmento | Fuera del Parcial 2 |
| RN-06 | Control y rangos de precios | **Sustituida por D-09** para alertas · PR-1 |
| RN-07 | Clasificación de elasticidad | **Sustituida por D-18** (banda de unitaria) |
| RN-08 | Alerta de precios entre zonas | PENDIENTE PR-2 |
| RN-09 | Parámetros de minería calibrados | **Sustituida por D-17 / RF-15** · PR-3 (lift) |
| RN-10 | Reglas duras y límites por zona | PENDIENTE PR-4 |
| RN-11 | Sustituibilidad | Método: **D-23** · disparador por umbral PENDIENTE PR-5 |
| RN-12 | Índice de accesibilidad | Vigente · complementada por D-02, D-03, D-04 |
| RN-13 | Bitácora con rol y antes/después | Vigente · PR-6 (falta campo rol) |
| RN-14 | Comparación entre proveedores y compra | PENDIENTE PR-7 |
| RN-15 | Perfil de consumo del usuario final | PENDIENTE PR-8 · choca con otras reglas |

## Definiciones

- **Canasta de Consumo**: Conjunto delimitado de productos representativos que adquiere un segmento de población bajo condiciones socioeconómicas particulares.
- **Canasta Básica**: Subconjunto de la canasta de consumo compuesto por los productos mínimos indispensables por segmento.
- **Canasta de Negocio**: Conjunto de productos que el propio negocio decide agrupar y ofrecer, más allá de lo clasificado como básico.
- **Segmento Socioeconómico**: Clasificación de zonas o grupos de consumidores según su nivel de ingreso y capacidad de compra.
- **Elasticidad Precio-Demanda**: Métrica estadística que mide el grado de variación en la cantidad demandada de un producto ante modificaciones en su precio.
- **Sustituibilidad**: Capacidad de un producto para reemplazar a otro equivalente en función de categoría, rango de precio o disponibilidad en punto de venta.
- **Índice de Accesibilidad Económica**: Indicador que evalúa la relación entre el costo total de la canasta básica regional y el ingreso disponible estimado para dicho segmento.

Nota de uso: en el código, "canasta" (sin calificativo) es la **canasta de una
transacción** (RF-09: una canasta = una transacción). La "canasta de consumo" de
estas definiciones es un agregado por segmento.

## 1. Clasificación socioeconómica y segmentación de zonas

### RN-01: Definición de segmentos de ingreso

> Las zonas geográficas se determinan por su ubicación dentro del Área Metropolitana de Monterrey. El cliente debe proporcionar el número de locales y sucursales físicas, así como si cada sucursal opera con páginas web independientes y la forma en que se gestionan sus datos.

**Estado vigente:** el texto describe zonas y tiendas, no segmentos. Los segmentos
reales están en `segmentos_ingreso` (fuente INEGI-ENIGH, rangos de ingreso por hogar,
asignados a la **zona agregada**, nunca a una persona). Aplican RF-05 y D-10.

### RN-02: Agrupación geográfica

> La agrupación geográfica se realiza mediante algoritmos de clustering, tomando como base territorial los 16 municipios principales del Área Metropolitana de Monterrey.

**Estado vigente:** vigente. Clustering en `analytics-stats` (RF-16). La clasificación
de zona admite asignación manual **o** por corrida de clustering
(`zona_clasificaciones`). Los datos de prueba usan 3 municipios; no es defecto.

## 2. Construcción y composición de canastas

### RN-03: Criterios de agrupación de transacciones

> Los umbrales (ventana de tiempo para considerar una transacción relevante, mínimo de unidades/transacciones para representatividad) se calculan internamente por el equipo, con base en el análisis estadístico del dataset (moda, media, distribución de volumen por transacción), y se recalibran periódicamente según el desempeño real de las canastas. Esto evita el riesgo de clasificar erróneamente productos como masivos cuando la media real de compra es baja, y permite que el umbral se ajuste automáticamente si el patrón de compra cambia.
>
> La elasticidad precio-demanda por producto y segmento se calcula utilizando las diferencias de precios mensuales observadas, validada contra el umbral mínimo calculado internamente.

**Estado vigente:** recalibración automática fuera del Parcial 2. La elasticidad usa
diferencias de precio por periodo; el **periodo mensual** es el default esperado.

### RN-04: Canasta básica de referencia

> El cliente debe proporcionar el historial de ventas y el stock/inventario de todas las sucursales. Adicionalmente, debe entregar la ficha detallada de cada producto, incluyendo como mínimo: ID, Nombre, Fotografía/Imagen, Precio y Unidades.
>
> El nivel de stock disponible se considera al construir cada canasta, ya que no es viable promocionar canastas con productos de poco inventario, dado que perderían vigencia rápidamente.

**Estado vigente:** la composición de la canasta básica la fija **D-03** (referencia
oficial adaptada al catálogo). El stock alimenta la disponibilidad (RF-36, D-13);
su fuente está pendiente (P-03).

### RN-05: Representatividad por segmento

> Una canasta se considera válida y representativa para un segmento socioeconómico cuando sus productos constituyentes están presentes en al menos el porcentaje mínimo de transacciones totales del segmento evaluado. Este porcentaje se calcula internamente por zona y segmento, siguiendo el mismo criterio de RN-03, para reflejar que segmentos distintos (por ejemplo San Pedro y Pesquería) no son comparables bajo un solo umbral.

**Estado vigente:** fuera del Parcial 2.

## 3. Precios y restricciones comerciales

### RN-06: Control y rangos de precios

> Los topes mínimos, máximos y variaciones porcentuales permitidas en la actualización de precios por producto/zona se calculan internamente a partir de la volatilidad histórica de precios observada por producto y por zona. Esto permite detectar variaciones anómalas reales en lugar de aplicar una regla genérica que no distinga entre productos perecederos y no perecederos.

**Estado vigente:** para la **alerta** de cambio de precio rige **D-09** (≥ 5 % dentro
de un periodo definido por el Responsable de precios). Topes que **bloqueen** un
precio: PENDIENTE PR-1.

### RN-07: Elasticidad precio-demanda

> El microservicio de algoritmos clasifica la elasticidad en tres rangos: Elástica (|E| > 1), Inelástica (|E| < 1) y Unitaria (|E| = 1), evaluando las reacciones de demanda frente a ajustes porcentuales de precio en cada segmento.

**Estado vigente:** **D-18** reemplaza la igualdad exacta: unitaria si
0.95 ≤ |E| ≤ 1.05; elástica si |E| > 1.05; inelástica si |E| < 0.95.

### RN-08: Comparación de precios inter-zonal

> El umbral de tolerancia para alertar desviaciones de precio excesivas entre zonas de similar o distinto nivel socioeconómico se calcula internamente, comparando la distribución de precios históricos entre zonas comparables. Esto da una base estadística defendible para las alertas, evitando falsos positivos por diferencias estructurales de costo entre zonas.

**Estado vigente:** la comparación entre zonas sigue **D-06**. La **alerta** entre
zonas no está en ningún servicio ni en la tabla de notificaciones: PENDIENTE PR-2.

## 4. Algoritmos de asociación (Apriori / FP-Growth)

### RN-09: Parámetros técnicos mínimos

> Los parámetros del microservicio de minería (Soporte Mínimo, Confianza Mínima y Lift) se calibran internamente a partir del propio dataset histórico, no como valores fijos impuestos externamente.

**Estado vigente:** **RF-15 y D-17** mandan: el Analista configura soporte y confianza
en (0, 1] antes de ejecutar. Valores calibrados solo como **sugerencia por defecto**.
Lift: PENDIENTE PR-3.

### RN-10: Restricciones de negocio para reglas de asociación

> Las asociaciones surgen del análisis de los datos históricos, complementadas con un conjunto de reglas duras configurables definidas y administradas internamente por el equipo (por ejemplo, exclusión de asociaciones entre artículos de limpieza y alimentos frescos), editables por un rol administrador dentro de la plataforma.
>
> Las canastas de consumo se generan filtradas por zona geográfica y segmento de ingreso, con rango de fechas configurable — no de forma global ni exclusivamente por sucursal individual. Los límites mínimos y máximos de precio (variaciones permitidas por porcentaje) se editan por zona a través del rol administrador, y cada edición queda registrada conforme a RN-13.

**Estado vigente:** filtros por zona, segmento y fechas: **vigente** (RF-10). Reglas
duras de exclusión y límites de precio editados por el Administrador: PENDIENTE PR-4
(la Matriz da al Administrador solo Lectura en Precios).

## 5. Sustitución y accesibilidad

### RN-11: Criterios de sustituibilidad

> El sistema recomienda automáticamente productos sustitutos cuando un producto de la canasta se agota. El criterio de sustituibilidad se calcula mediante elasticidad cruzada entre productos a partir de los datos históricos, complementado con similitud de subcategoría y rango de precio.
>
> La sustitución se activa tanto por desabasto registrado en la app móvil como de forma automática cuando el precio de un producto supera el umbral de tolerancia calculado internamente en RN-06.

**Estado vigente:** RF-17 exige identificar sustitución **dentro de la misma
categoría**. **D-23** fija el método: indicio por coocurrencia (lift) y
correlación de precio, no elasticidad cruzada. El disparador por desabasto no
aplica sin historial de inventario. El disparador por umbral de precio (RN-06):
PENDIENTE PR-5.

### RN-12: Índice de accesibilidad económica

> El índice se calcula como la relación entre el costo total de la canasta básica regional y el ingreso disponible estimado del segmento correspondiente, tomando como referencia metodológica fuentes públicas (México Cómo Vamos) y los segmentos definidos en RN-01/RN-02. El cálculo se realiza por zona, no de forma global, ya que la canasta básica de una zona (por ejemplo San Pedro) no equivale a la de otra (por ejemplo Pesquería).

**Estado vigente:** vigente. **D-02** agrega el puntaje compuesto 0–1 como detalle
(cifra principal = % del ingreso). **D-03** canasta de referencia oficial. **D-04**
básico sin precio se estima y se marca. Siempre por zona.

## 6. Auditoría

### RN-13: Registro de bitácora y cambios de reglas

> Cuando un operador edita o personaliza manualmente las canastas o modifica parámetros de precios, la plataforma registra el evento en MongoDB/PostgreSQL guardando tiempo, ID de usuario, rol y el estado previo/posterior de la modificación.

**Estado vigente:** vigente. El contrato `AuditLog` (userId, action, entityType,
entityId, timestamp, metadata) **no tiene campo rol**: PR-6. Antes/después va en
`metadata`. La bitácora es inmutable (M15).

## 7. Proveedores

### RN-14: Registro y comparación de proveedores

> Los proveedores se registran en la plataforma y publican sus precios. El negocio minorista puede comparar precios entre distintos proveedores del mismo producto y decidir a quién comprarle y en qué cantidad (por ejemplo, toneladas). La compra realizada se incorpora al inventario del negocio y se convierte en la base para la construcción de sus canastas.
>
> La logística de entrega, el rastreo de vehículos de proveedores, la optimización de rutas y los centros de distribución quedan fuera del alcance de esta plataforma.

**Estado vigente:** registro y propuesta de precios del Proveedor: vigente (RF-12, D1).
Comparación **entre proveedores**, decisión de compra e inventario: PENDIENTE PR-7
(ningún servicio ni RF lo cubre). Logística: fuera de alcance.

## 8. Perfil de consumo

### RN-15: Clasificación de perfil de consumo

> En el registro del usuario final en la app móvil, el sistema captura un perfil básico de consumo (por ejemplo, si vive solo o si depende de/mantiene a varias personas). Este perfil determina la frecuencia esperada de compra (diaria, cada tres días, semanal, quincenal o mensual) y se utiliza junto con los filtros de zona geográfica y segmento de ingreso (RN-01, RN-05) para ajustar las recomendaciones de canasta a nivel individual.

**Estado vigente:** PENDIENTE PR-8. Choca con: (a) RF-32, la app móvil es para el
personal de investigación de mercado, no para consumidores; (b) la regla de no
inferir ni personalizar a nivel individual (segmentos por zona agregada).

## Alcance

Dentro de alcance:

- Construcción y recomendación de canastas de consumo por zona, segmento de ingreso, rango de fechas y perfil de usuario.
- Cálculo interno de umbrales, elasticidad, accesibilidad económica y reglas de asociación.
- Registro y comparación de precios entre proveedores.
- Auditoría y trazabilidad de cambios de reglas y precios.

Fuera de alcance:

- Logística de entrega y rastreo de vehículos de proveedores.
- Optimización de rutas o centros de distribución.
- Visualización o simulación 3D de cadena de suministro.

## Pendientes derivados de estas reglas

| ID | Pregunta | Afecta |
|---|---|---|
| PR-1 | ¿Hay topes que **bloqueen** un precio (RN-06), o solo la alerta de D-09? | pricing |
| PR-2 | ¿Se implementa la alerta de desviación entre zonas (RN-08)? ¿A quién se notifica? | pricing, notifications |
| PR-3 | ¿Se calcula y filtra por **lift** en las reglas de asociación? | algorithms-core |
| PR-4 | Reglas duras de exclusión y límites de precio por zona: ¿existen? ¿quién las edita, si el Administrador solo tiene Lectura en Precios? | algorithms-core, pricing, Matriz |
| PR-5 | Disparadores de la sustitución: umbral de precio de RN-06, y desabasto en móvil (requiere historial de inventario). El método quedó en D-23. | algorithms-core, móvil |
| PR-6 | ¿Se agrega el campo `rol` a `AuditLog`, o va en `metadata`? | audit-service y todos |
| PR-7 | ¿Entra la comparación entre proveedores, la compra y el inventario? ¿En qué parcial? | pricing, catalog |
| PR-8 | ¿RN-15 se descarta, o se redefine como perfil de **hogar por zona** (agregado)? | móvil, decision |
