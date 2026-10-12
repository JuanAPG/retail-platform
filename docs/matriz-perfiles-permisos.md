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
> Última actualización: 2026-10-10 · Responsable: Product Owner (Juan Angel).

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

### 3.1 Módulos sin fila en la Matriz (PENDIENTE)

| Módulo | Servicio | Estado |
|---|---|---|
| Analítica descriptiva (M09) | core-process-service | P-07 · se asume igual que Canastas |
| Sustitución (RF-17) | algorithms-core | P-07 · ¿va con Asociación o con Elasticidad? |
| Clustering, hipótesis, ANOVA, proporciones (RF-16, 20–22) | analytics-stats | P-07 |
| Notificaciones (M17) | notifications-service | P-07 · se asume LA de lo propio para todos |
| Configuración analítica: canasta básica (D-03), periodo de alerta (D-09), umbrales (D-13) | varios | P-07 |
| Captura de campo: precio observado, disponibilidad, encuestas, ubicación (RF-33 a RF-38) | por definir | P-01, P-03 |
| Portal público (sin sesión) | web | P-09 |

## 4. Decisiones de negocio vigentes

### 4.1 Arquitectura y responsabilidades

| ID | Decisión |
|---|---|
| D1 | Solo el **Responsable de precios** aprueba o rechaza propuestas de precio. |
| D2 | **FP-Growth** vive en `algorithms-core` (Leonardo), junto a Apriori: `POST /v1/association/fpgrowth/run`. `AnalysisRun.algorithm ∈ {apriori, fpgrowth}`: se guarda como el parámetro `algoritmo` de la corrida (`analisis_corrida_parametros`), sin columna nueva en `analisis_corridas`, y viaja en `parameters` de `/runs` y `/runs/:id`. |
| D3 | Las corridas de Apriori, FP-Growth y clustering se guardan en **MongoDB**, no en PostgreSQL. |

### 4.2 Reglas de negocio (D-01 a D-23)

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
| P-03 | ¿Qué servicio guarda disponibilidad (RF-36) y encuestas (RF-38)? | catalog/decision, Mongo |
| P-04 | ¿Qué roles usan la app de escritorio? ¿El Analista puede simular (RF-47) y calcular elasticidad (RF-45)? | desktop, Matriz |
| P-05 | Periodo por defecto de la alerta de precio (D-09) mientras el Responsable no lo configure. | pricing, notifications |
| P-06 | ¿Qué es un reporte "propio" del Proveedor? | documents (DOC-04) |
| P-07 | Permisos de los módulos de §3.1. | varios |
| P-08 | Código de barras no encontrado en campo: ¿qué flujo sigue? | catalog, móvil |
| P-09 | ¿Qué muestra el portal público sin sesión? | web |
| P-10 | Confirmar Auditoría como solo Lectura (bitácora inmutable). | audit |

## 7. Cómo mantener este archivo

- Toda decisión nueva entra en §4 con su ID y una línea "cómo se verifica".
- Al resolver un pendiente se mueve de §6 a §4; no se borra el ID.
- Si cambia un rol o permiso, se actualizan también `roles.ts` (los 10 servicios),
  `db/data_retail.sql` y se avisa al equipo para el `.docx`.
