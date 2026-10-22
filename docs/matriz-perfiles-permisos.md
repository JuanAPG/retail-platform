# Matriz de perfiles, permisos y decisiones de negocio

> **Fuente de verdad para agentes y revisores (QA, Claude Code).**
> Este archivo es la versión legible de `S0_Matriz_de_Perfiles_y_Permisos` más
> las decisiones de negocio tomadas después. Cuando el código, un contrato o un
> README contradigan este archivo, **gana este archivo** y la discrepancia se
> reporta como hallazgo.
>
> Precedencia: **Decisiones (§4) > Matriz (§3) > Requerimientos
> (`docs/requerimientos.md`) > Reglas de negocio (`docs/reglas-negocio.md`) >
> Contratos (`docs/contratos/`) > READMEs de servicio.**
>
> Lo marcado **PENDIENTE** no está decidido. Un agente **no lo asume ni lo
> implementa**: lo reporta como *hallazgo de especificación* y sigue.
>
> Última actualización: 2026-10-21 (junta de Sprint 4: D-33 a D-47) · Responsable:
> Product Owner (Juan Angel).

---

## 1. Roles

Los nombres son **exactos** (coinciden con la tabla `roles` y con `ROL` en
`services/*/src/common/roles.ts`).

| # | Rol | Tipo | Descripción |
|---|---|---|---|
| 1 | `Administrador` | Interno | Gestiona usuarios, perfiles y configuración general. |
| 2 | `Analista comercial` | Interno | Integra transacciones, construye canastas, ejecuta reglas de asociación y calcula accesibilidad. |
| 3 | `Gerente de categoría` | Interno | Gestiona el catálogo de productos y compara precios entre zonas. |
| 4 | `Responsable de precios` | Interno | Gestiona precios y calcula la elasticidad precio-demanda. |
| 5 | `Planeador` | Interno | Diseña y ejecuta simulaciones de formatos, empaques y descuentos. |
| 6 | `Auditor` | Interno | Consulta bitácoras de auditoría y valida el cumplimiento de reglas. |
| 7 | `Proveedor` | Externo | Empresa que da de alta sus propios productos; no necesariamente ligados a una tienda. |
| 8 | `Investigador de mercado` | Interno | **PENDIENTE (P-01).** Usuario de la app móvil (RF-32). No existe aún en la tabla `roles`. |

## 2. Niveles de permiso

La columna "Clave BD" es el valor del ENUM `nivel_permiso` en `db/schema.sql`.

| Nivel | Clave BD | Significado | Respuesta esperada al exceder el nivel |
|---|---|---|---|
| Total | `total` | Crear, leer, actualizar y eliminar. | — |
| Lect./Act. | `lectura_actualiza` | Leer y actualizar; sin crear ni eliminar. | `POST`/`DELETE` → `403` |
| Lectura | `lectura` | Solo consulta. | Cualquier escritura → `403` |
| Lectura (propios) | `lectura_propios` | Solo consulta de lo que le pertenece. | Recurso ajeno → **`404`** (no se confirma que exista) |
| Propone | `propone` | Crea/edita, pero queda **pendiente** de aprobación. | Aprobar lo propio → `403` |
| Aprueba | `aprueba` | Revisa y aprueba/rechaza lo propuesto por otro rol. | — |
| Sin acceso | `sin_acceso` | Ninguna operación. | `403` |

Reglas generales:

- Sin token, token expirado, manipulado o **sesión revocada en Redis** → `401`.
- Token válido con rol sin permiso → `403`.
- Recurso ajeno para un rol con permiso *de lo propio* → `404`, mismo cuerpo que un
  recurso inexistente.
- Una celda con dos niveles (por ejemplo "Total + Aprueba") significa ambos.

## 3. Matriz por módulo

Leyenda corta: **T** Total · **LA** Lect./Act. · **L** Lectura · **LP** Lectura
(propios) · **P** Propone · **A** Aprueba · **–** Sin acceso.

| Módulo / función | Clave | Servicio dueño | Admin | Analista | Gerente | Resp. precios | Planeador | Auditor | Proveedor |
|---|---|---|---|---|---|---|---|---|---|
| Usuarios y perfiles | M01 | auth-service | T | – | – | – | – | L | – |
| Catálogo de proveedores (datos de empresa) | M01 | auth-service | T | L | L | – | – | L | LA (su empresa) |
| Tiendas | M02 | catalog-service | T | L | L | L | L | L | – |
| Zonas | M03 | catalog-service | T | L | L | L | L | L | – |
| Catálogo de productos | M04 | catalog-service | L | L | T | L | L | L | P |
| Alta de productos por proveedor | M04 | catalog-service | L | – | A | – | – | L | P |
| Segmentos de ingreso | M05 | catalog-service | L | T | L | L | L | L | – |
| Transacciones | M06 | core-process-service | L | T | L | L | L | L | – |
| Canastas | M07 | core-process-service | L | T | L | L | L | L | – |
| Precios | M08 | pricing-service | L | L | L | **T + A** ⁽¹⁾ | L | L | P |
| Comparación de precios | M08 | pricing-service | L | L | T | L | L | L | LP |
| Reglas de asociación (Apriori, FP-Growth) | M10 | algorithms-core | L | T | L | L | L | L | – |
| Elasticidad | M11 | algorithms-core | L | L | L | T | L | L | – |
| Estadística: clustering, hipótesis, ANOVA, proporciones (RF-16, 20–22) ⁽⁵⁾ | — | analytics-stats | L | T | L | L | L | L | – |
| Indicadores de accesibilidad | M12 | decision-service | L | T | L | L | L | L | – |
| Simulación de formatos y empaques | M13 | decision-service | L | L | L | L | T | L | – |
| Recomendaciones ⁽²⁾ | M14 | decision-service | L | L | **A** | L | **T** | L | – |
| Reportes ejecutivos | M16 | documents-service | L | L | T | L | L | L | LP ⁽³⁾ |
| Auditoría | M15 | audit-service | L | – | – | – | – | **L** ⁽⁴⁾ | – |

Notas:

1. **D1:** el Responsable de precios es el **único** que aprueba o rechaza precios
   propuestos. Gerente y Administrador no aprueban precios.
2. **D-12:** fila agregada (no existía en la Matriz S0). Genera el Planeador; acepta o
   rechaza el Gerente de categoría; al decidir se notifica al Auditor.
3. Qué es un reporte "propio" del Proveedor: **PENDIENTE (P-06).**
4. La Matriz S0 dice "Total", pero M15 está definida como **bitácora inmutable**
   (`db/data_retail.sql`): nadie actualiza ni borra registros. Se trata como Lectura
   (más el alta automática que hacen los servicios). **Confirmar (P-10).**
5. **D-24:** fila agregada (no existía en la Matriz S0; estaba en P-07). Ejecutar una
   prueba o una corrida de clustering es Total del Analista comercial; los demás
   perfiles internos leen las corridas guardadas.

### 3.1 Módulos sin fila en la Matriz (PENDIENTE)

| Módulo | Servicio | Estado |
|---|---|---|
| Analítica descriptiva (M09) | core-process-service | P-07 · se asume igual que Canastas |
| Sustitución (RF-17) | algorithms-core | P-07 · ¿va con Asociación o con Elasticidad? |
| Clustering, hipótesis, ANOVA, proporciones (RF-16, 20–22) | analytics-stats | Resuelto por **D-24** (fila en §3) |
| Notificaciones (M17) | notifications-service | P-07 · se asume LA de lo propio para todos |
| Configuración analítica: canasta básica (D-03), periodo de alerta (D-09), umbrales (D-13) | varios | P-07 |
| Captura de campo: precio observado, disponibilidad, encuestas, ubicación (RF-33 a RF-38) | por definir | P-01, P-03 |
| Portal público (sin sesión) | web | P-09 |

### 3.2 Servicios nuevos del Sprint 4 (D-47)

Cada responsable completa la fila de su servicio, con los 7 perfiles, al escribir su
contrato (límite 23-oct). Aquí solo está lo que ya fijó una decisión; lo demás es
**PENDIENTE** y no se implementa hasta que la fila esté completa.

| Servicio | Puerto | Responsable | Ya decidido | Pendiente |
|---|---|---|---|---|
| `transactions-ingestion-service` | 3111 | Juan Angel | Recibe la importación por archivo que antes hacía core-process (D-33, D-34). | Fila completa. |
| `income-segmentation-service` | 3112 | Pamela | Recibe segmentos y clasificación de zonas de catalog (D-35); umbral de publicación (D-36). | Fila completa. |
| `basket-analysis-service` | 3113 | Leonardo | Canasta típica (D-37); umbral de publicación (D-36). | Fila completa. |
| `availability-service` | 3114 | Pamela | Recibe la disponibilidad (D-38). | Fila completa. |
| `promotion-service` | 3115 | Fernando | **Gerente de categoría: Propone. Responsable de precios: Aprueba** (D-39). | Los otros 5 perfiles. |
| `demand-forecast-service` | 3116 | Leonardo | Método y validación (D-40). | Fila completa. |
| `recommendations-workflow-service` | 3117 | Fernando | **Gerente de categoría: asigna y evalúa. El responsable asignado mueve los estados** (D-41). | Qué roles pueden ser responsables asignados; los demás perfiles. |
| `offline-sync-service` | 3118 | Fernando | Idempotencia y conflictos (D-42). | Fila completa; depende de P-01 (rol de la app móvil). |
| `data-governance-service` | 3119 | Leonardo | Retención, calidad y linaje (D-43). | Fila completa. |
| `monitoring-service` | 3120 | Juan Angel | **Solo el Administrador** ve el panel (D-44). | — |

## 4. Decisiones de negocio vigentes

### 4.1 Arquitectura y responsabilidades

| ID | Decisión |
|---|---|
| D1 | Solo el **Responsable de precios** aprueba o rechaza propuestas de precio. |
| D2 | **FP-Growth** vive en `algorithms-core` (Leonardo), junto a Apriori: `POST /v1/association/fpgrowth/run`. `AnalysisRun.algorithm ∈ {apriori, fpgrowth}`: se guarda como el parámetro `algoritmo` de la corrida (`analisis_corrida_parametros`), sin columna nueva en `analisis_corridas`, y viaja en `parameters` de `/runs` y `/runs/:id`. |
| D3 | Las corridas de Apriori, FP-Growth y clustering se guardan en **MongoDB**, no en PostgreSQL. |

### 4.2 Reglas de negocio (D-01 a D-47)

| ID | Área | Decisión vigente | Cómo se verifica |
|---|---|---|---|
| D-01 | Simulación de precio | **Reacción decreciente** (elasticidad constante). Ej.: demanda 1,000, precio 25 → 27.5, E = −2 → **826 unidades, ingreso −9.1 %**. El modelo se declara en los supuestos del escenario. | Con esos datos debe salir 826 / −9.1 %. 800 / −12 % es incorrecto. |
| D-02 | Accesibilidad | Se muestran **los dos**: % del ingreso que cuesta la canasta básica (cifra principal; más alto = menos accesible) y puntaje compuesto 0–1 (detalle; más alto = más accesible). | La respuesta trae ambos valores con su sentido documentado. |
| D-03 | Canasta básica | Se toma de una **referencia oficial** (p. ej. CONEVAL) adaptada al catálogo: producto, presentación y cantidad. | La composición está en datos, no en una constante del código. |
| D-04 | Accesibilidad | Básico sin precio en la zona → **se estima** con el promedio de otras zonas y el resultado se **marca como estimado**. | Nunca se omite en silencio. |
| D-05 | Precios | Se puede **programar** un precio a futuro: entra en vigor en su fecha; el actual sigue vigente hasta el día anterior. | Precio futuro no cambia el vigente hoy. |
| D-06 | Comparación de precios | **Dos vistas**: por presentación (una fila por zona y presentación) y normalizada por kg/L. | Nunca se promedian presentaciones distintas. |
| D-07 | Catálogo | Tienda o presentación con historial de precios **solo se desactiva**, nunca se borra. | El historial queda intacto. |
| D-08 | Alta de productos | Producto pendiente o rechazado: lo ven **solo el Gerente** (en su bandeja) y el **Proveedor que lo propuso**. Para el resto no existe hasta aprobarse; no se puede preciar ni vender. | Ver `VEN_NO_ACTIVOS` en catalog-service. |
| D-09 | Alertas de precio | Se avisa al Responsable de precios y al Auditor con cambio **≥ 5 %** dentro de un **periodo que define el Responsable de precios**. | Valor por defecto del periodo: **PENDIENTE (P-05)**. |
| D-10 | Segmentos | Rangos que se enciman → **rechazar**. Ingreso negativo o mínimo > máximo → `400`. | Nunca `500`. |
| D-11 | Proveedor | Puede **editar mientras esté pendiente**. Si se rechaza, hace una propuesta nueva. | Rechazado no se reabre. |
| D-12 | Recomendaciones | **Genera el Planeador, decide el Gerente**; se avisa al Auditor. | Ver §3. |
| D-13 | Recomendaciones | Menor ingreso = segmento más bajo · alto desembolso = presentación más cara del producto · baja disponibilidad = < 50 % de tiendas con existencia · alta frecuencia = top 20 % de productos más comprados. | Umbrales en configuración, no dispersos en el código. |
| D-14 | Simulación de empaque | Se comparan **todas las presentaciones del mismo producto** (mínimo 3). No se mezclan productos. | Producto distinto → `400`. |
| D-15 | Corridas de análisis | Repetir una corrida guardada da **exactamente lo mismo**: se guarda una foto (snapshot o hash) de los datos usados. | Mismos parámetros + mismos datos → mismas reglas, mismo orden. |
| D-16 | App móvil | Precio levantado en campo **pasa a aprobación** del Responsable de precios. Aprobado, es un precio normal; el origen **"campo"** solo queda en la propuesta y en la auditoría. | Ver §5. |
| D-17 | Asociaciones | Soporte y confianza en **(0, 1]**; umbral inclusivo (`>=`). | 0, negativos y > 1 → `400`. |
| D-18 | Elasticidad | Unitaria si **0.95 ≤ \|E\| ≤ 1.05**. | 0.95 y 1.05 son unitarias. |
| D-19 | Alcance al 13-oct | Lo que se presenta incompleto si falta tiempo: **exportación a Excel** (solo PDF). | `format=xlsx` → error claro, nunca `500`. |
| D-20 | Reportes | El reporte ejecutivo trae **los 16 indicadores** de la retroalimentación. Si un servicio no responde en 3 s, su indicador sale `disponible:false` con motivo, **nunca 0**. | Ver contrato de documents-service. |
| D-21 | Elasticidad | `POST /v1/elasticity/calculate` agrupa las ventas por **día, semana o mes** (`granularity`); default **semana**. RN-03 pide mes, pero queda **fuera del Parcial 2**, así que no es una regla vigente que cumplir todavía: semana se eligió porque promedia el ruido de entre-semana/fin-de-semana sin diluir los cambios de precio (día es más ruidoso; mes da muy pocos puntos con poca historia). | Sin `granularity`, la corrida sale con `granularity: "week"`. |
| D-22 | Elasticidad | `GET /v1/elasticity/current` solo cuenta como **vigente** la corrida completada más reciente **sin** `dateFrom`/`dateTo` (ventana completa). Una corrida con esos filtros es exploratoria: nunca se promueve aquí aunque sea la más reciente; se consulta por su `runId` en `GET /v1/elasticity/chart`. | Una corrida filtrada por fecha no cambia lo que devuelve `/current`, aunque sea posterior a la vigente. |
| D-23 | Sustitución | `GET /v1/substitution/patterns` detecta **indicios** de sustitución dentro de una misma categoría por **coocurrencia** (lift < 1 sobre las canastas que compraron la categoría, con al menos 1 coocurrencia esperada y al menos 2 canastas por producto) y **correlación de precio** (Pearson entre el precio vigente de A y "la canasta llevó B": `precio` si r ≥ 0.3, si no `preferencia`). **No es elasticidad cruzada.** El disparador por **desabasto no aplica**: no hay historial de inventario. Cada par trae su evidencia: `priceVariation` = (máximo − mínimo) / mínimo del precio de A; `originFrequencyChange` y `targetFrequencyChange` = proporción de canastas con A (o con B) cuando A está caro menos cuando está barato, con el corte en el punto medio entre el precio mínimo y el máximo de A. Es un indicio, nunca una causa. Resuelve el **método** de PR-5; el disparador por umbral de precio (RN-06) sigue PENDIENTE. | 12 canastas: leche a $10 en 6 (5 llevan leche, 1 queso) y a $12 en 6 (1 leche, 5 queso) → Leche → Queso tipo `precio`, lift 0, r = 0.6667, `priceVariation` 0.2, frecuencias −0.6667 y +0.6667 (`substitution.spec.ts`). |
| D-24 | Estadística (analytics-stats) | Permisos de RF-16 y RF-20 a RF-22, iguales a M10: solo el **Analista comercial** ejecuta pruebas de hipótesis, ANOVA, proporciones y corridas de clustering (Total); los 6 perfiles internos leen las corridas de clustering guardadas; el **Proveedor** no tiene acceso. Las pruebas se calculan al vuelo y no se guardan. Resuelve P-07 para este módulo. | Proveedor → `403` en todas las rutas; Administrador → `403` en `POST /v1/anova` y en `POST /v1/clustering/run`, `200` en `GET /v1/clustering/runs`. |
| D-25 | Errores | MongoDB caído (o cualquier almacén que el servicio no pueda alcanzar) responde **503 `SERVICE_UNAVAILABLE`**, no 500. Aplica a documents, notifications y a las corridas de algorithms-core y analytics-stats (D3). | Con Mongo detenido, `GET /v1/notifications` → 503 con el error estándar en JSON y XML; `GET /v1/health` → 200 `degraded`. |
| D-26 | Usuarios | Las respuestas de los servicios traen solo el **id** del usuario. El **nombre** lo resuelve el cliente consultando a `auth-service`; ningún servicio lo copia ni lo inventa. | Una bandeja o un reporte muestran `userId`; la web o el escritorio piden el nombre a auth. |
| D-27 | Límites del Parcial 2 | Se aceptan y documentan como límites conocidos: (a) el clustering de zonas solo admite **k = 2** mientras el seed tenga 3 zonas; (b) el modo `baskets` de analytics-stats lee como máximo **500 páginas** de canastas por prueba; (c) `analisis_corridas` es de algorithms-core y `decision-service` también escribe en ella (corridas de accesibilidad, `tipo` propio): se corrige después del parcial. | Pedir k = 3 con 3 zonas → 400 con motivo claro; no se interpreta como error del servicio. |

**D-28 a D-32 no están registradas en este archivo** (P-12). D-28 existe solo en la
rama sin fusionar `fix/matriz-tiendas-zonas` ("el Gerente escribe tiendas y el
Analista zonas; el Administrador solo lee") y contradice lo que `main` aplicó en el PR
#72 (el Administrador escribe tiendas y zonas, Matriz §3): rige §3. D-30 (la
disponibilidad en catalog-service) la sustituye D-38. D-29, D-31 y D-32: sin texto.

#### Sprint 4 (de 10 a 20 microservicios): junta del 21-oct-2026

Se aceptaron las 15 propuestas del tablero del sprint (Q-01 a Q-15) tal como estaban
escritas. Cada decisión dice de qué duda viene.

| ID | Área | Decisión vigente | Cómo se verifica |
|---|---|---|---|
| D-33 | Importación de ventas (Q-01) | La importación por archivo **sale de core-process** y pasa completa a `transactions-ingestion-service`: lotes, vista previa, deduplicación, conciliación y errores (tablas `importaciones*`). core-process conserva el registro manual, las transacciones confirmadas y las canastas. Al confirmar un lote, ingestion envía las transacciones válidas a core-process **por HTTP**. | Un lote confirmado en ingestion aparece como canastas en core-process; core-process ya no expone `import/*`. |
| D-34 | Duplicados (Q-02) | Dos transacciones son la misma si tienen **misma tienda + mismo folio**. Si además cambia el contenido, la fila se marca como **conflicto** para revisión, no se sobrescribe. Reimportar un lote ya confirmado no crea nada. | Reimportar el mismo lote → 0 transacciones nuevas; misma tienda y folio con otro total → fila en conflicto. |
| D-35 | Segmentos de ingreso (Q-03) | Los segmentos y la clasificación de zonas **salen de catalog-service** y pasan a `income-segmentation-service`. Cada cambio crea una **versión nueva** con fuente y fecha; la anterior se conserva y cada clasificación guarda con qué versión se hizo. Rangos encimados se siguen rechazando (D-10). | Editar un segmento crea la versión 2 y la 1 sigue consultable; rango encimado → 400. |
| D-36 | Anonimización (Q-04) | No se publica ningún agregado con **menos de 10 transacciones (o 3 tiendas)** en la combinación zona-segmento: sale como no disponible, con motivo. Nunca se guarda ni se infiere el ingreso de una persona. Cómo se combinan los dos umbrales: P-11. | Una combinación con 9 transacciones → `disponible:false` con motivo, nunca un número. |
| D-37 | Canasta típica (Q-05) | Canasta típica de un grupo (zona + segmento) = los productos presentes en **al menos el 20 %** de sus canastas, con su frecuencia y gasto promedio. core-process conserva sus 5 indicadores; `basket-analysis-service` agrega comparación entre periodos, evolución y mezcla por categoría. | Producto en 20 % de las canastas → entra; en 19 % → no entra. |
| D-38 | Disponibilidad (Q-06) | La disponibilidad **pasa a `availability-service`** (tabla `inventario` y capturas); **sustituye a D-30**. Faltante = existencia 0 de un producto de la canasta básica (D-03). Un dato vale **7 días**; después sale como vencido. Cobertura = % de básicos con existencia en la tienda. | Dato de hace 8 días → vencido, no disponible; cobertura con caso de control en las pruebas. |
| D-39 | Promociones (Q-07) | Tipos: **descuento %**, **precio por paquete** (n por $) y **tamaño de empaque**. Las **propone el Gerente de categoría** y las **aprueba el Responsable de precios**. No tocan el histórico de precios ni la elasticidad; el precio unitario se calcula aparte para comparar alternativas. | Aprobar una promoción no anexa nada a `precios`; el Gerente no puede aprobar la suya → 403. |
| D-40 | Pronóstico de demanda (Q-08) | **Holt-Winters** (suavizamiento exponencial con estacionalidad) por **semana** (D-21), horizonte de **8 semanas**, intervalos de **80 % y 95 %**. Se valida dejando fuera las **últimas 4 semanas** y se reporta el **MAPE**. Con **menos de 12 semanas** de historia → **422** con motivo. | 11 semanas → 422; misma entrada → mismo resultado. |
| D-41 | Seguimiento de recomendaciones (Q-09) | decision-service genera y el Gerente aprueba o rechaza (D-12). Una aprobada pasa al seguimiento en `recommendations-workflow-service`: **Asignada** (el Gerente asigna responsable) → **En implementación** → **Implementada** → **Evaluada** (con métrica de impacto: ventas o precio unitario antes y después). El responsable asignado mueve los estados; el Gerente evalúa. | Una recomendación no aprobada no entra; un salto de estado fuera de orden → 409. |
| D-42 | Sincronización sin conexión (Q-10) | Cada captura trae un **id único generado en el dispositivo** (idempotencia: reenviarla no la duplica). Si el servidor ya tiene un dato **más reciente** para la misma tienda y presentación, la captura queda como **conflicto** y no sobrescribe. Se acusa al dispositivo con su estado: aceptada, duplicada, conflicto o rechazada. | Enviar el mismo lote dos veces → todas `duplicada` la segunda vez. |
| D-43 | Gobierno de datos (Q-11) | Retención: transacciones **3 años**, capturas de campo **1 año**, notificaciones **90 días** (ya existe), bitácora **sin borrado**. Calidad: completitud, duplicados, valores fuera de rango y frescura, por fuente. Cada importación, versión de segmento y corrida registra su **linaje** (de qué fuente y versión salió). | Un lote importado aparece con fuente, versión, quién y cuándo. |
| D-44 | Monitoreo (Q-12) | El panel lo ve **solo el Administrador**. **Degradado**: responde pero alguna dependencia falla o tarda más de 1 s. **Caído**: no responde en 3 s o da error 2 veces seguidas. Se revisa **cada 30 s**. | Detener un servicio lo marca caído en menos de 1 min; otro rol → 403. |
| D-45 | Recuperación de acceso (Q-13) | Token de **un solo uso en Redis**, vigencia **15 min**. En local se entrega por notifications-service y queda en el log de desarrollo; el correo real se conecta en GCP. La respuesta es **la misma exista o no el correo**. | Reusar el token → rechazado; correo inexistente → misma respuesta que uno existente. |
| D-46 | Preferencias y descargas (Q-14) | Se pueden **apagar los avisos informativos**; los de **aprobación pendiente no**. El CSV del reporte trae los **16 indicadores** (los no disponibles con motivo, D-20). Cada descarga queda en la bitácora con quién, cuándo y qué formato. | Apagar un aviso de aprobación pendiente → sigue llegando; cada descarga deja un evento en audit-service. |
| D-47 | Permisos y datos de los servicios nuevos (Q-15) | Cada servicio nuevo tiene **fila en §3.2** antes de su contrato (23-oct). **Postgres** para datos de negocio; **MongoDB** para corridas de pronóstico, historial de monitoreo y lotes de sincronización; **Redis** para idempotencia, caché y último estado. Cualquier otro uso de Mongo o Redis se registra como decisión. | Ningún servicio nuevo usa Mongo o Redis fuera de esta lista sin una decisión registrada. |

## 5. Flujos con estado

### 5.1 Propuesta de producto (Proveedor; Investigador → P-01)

```
Proveedor propone ──► PENDIENTE ──► Gerente aprueba ──► ACTIVO (visible a todos)
                         │  ▲
     (edita, D-11) ──────┘  │
                         └──► Gerente rechaza (motivo obligatorio) ──► RECHAZADO (final)
```

- Notificaciones: al proponer → Gerente · al decidir → Proveedor y Auditor.
- Auditoría: alta, edición, aprobación y rechazo, con valores antes/después.

### 5.2 Propuesta de precio (Proveedor; Investigador por D-16)

```
Propone sobre presentación ACTIVA ──► PENDIENTE (el precio vigente NO cambia)
   ──► Resp. de precios aprueba ──► se ANEXA al histórico (nunca sobrescribe)
   ──► Resp. de precios rechaza (motivo) ──► RECHAZADA
```

- Se guardan `proposedBy`, `approvedBy` y `origen` (`proveedor` | `campo`).
- Notificaciones: `price.proposed` → Responsable de precios · decisión → quien propuso y Auditor.
- Auditoría: `metadata.origen = "campo"` cuando viene de la app móvil (D-16).

### 5.3 Escaneo en campo ("detectado en campo") — PENDIENTE parcial

Definido:

- La presentación tiene `codigo_barras` único (`producto_presentaciones`).
- Un precio capturado en campo sigue el flujo 5.2.

Sin definir (no implementar hasta decidir):

- P-01 rol que usa la app móvil.
- P-02 si un precio aprobado desde una tienda vale para **toda la zona** o se registra **por tienda**.
- P-03 qué servicio guarda disponibilidad y encuestas.
- P-08 qué pasa al escanear un código que no existe (¿propuesta de producto con `origen: campo`?).

## 6. Pendientes de especificación

| ID | Pregunta | Afecta |
|---|---|---|
| P-01 | ¿Se crea el rol `Investigador de mercado`? ¿Qué permisos tiene? | app móvil, auth, Matriz |
| P-02 | Precio de campo aprobado: ¿precio de la zona o precio por tienda? | pricing, elasticidad, D-09 |
| P-03 | ¿Qué servicio guarda las encuestas (RF-38)? (La disponibilidad, RF-36, quedó en availability-service por D-38.) | encuestas, Mongo |
| P-04 | ¿Qué roles usan la app de escritorio? ¿El Analista puede simular (RF-47) y calcular elasticidad (RF-45)? | desktop, Matriz |
| P-05 | Periodo por defecto de la alerta de precio (D-09) mientras el Responsable no lo configure. | pricing, notifications |
| P-06 | ¿Qué es un reporte "propio" del Proveedor? | documents (DOC-04) |
| P-07 | Permisos de los módulos de §3.1. | varios |
| P-08 | Código de barras no encontrado en campo: ¿qué flujo sigue? | catalog, móvil |
| P-09 | ¿Qué muestra el portal público sin sesión? | web |
| P-10 | Confirmar Auditoría como solo Lectura (bitácora inmutable). | audit |
| P-11 | D-36: "menos de 10 transacciones (o 3 tiendas)". ¿Se publica solo con **≥ 10 transacciones y ≥ 3 tiendas**, o basta con cumplir una? Con el seed actual (3 zonas) exigir 3 tiendas por zona-segmento puede ocultar casi todo. | income-segmentation, basket-analysis |
| P-12 | Texto de D-28 a D-32. D-28 vive solo en una rama sin fusionar y contradice a `main`; D-29, D-31 y D-32 no aparecen en ningún lado. ¿Se descartan o se registran? | Matriz |

## 7. Cómo mantener este archivo

- Toda decisión nueva entra en §4 con su ID y una línea "cómo se verifica".
- Al resolver un pendiente se mueve de §6 a §4; no se borra el ID.
- Si cambia un rol o permiso, se actualizan también `roles.ts` (los 10 servicios),
  `db/data_retail.sql` y se avisa al equipo para el `.docx`.
