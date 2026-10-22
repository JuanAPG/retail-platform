# Convenciones del equipo

> **Sprint actual: Sprint 4, del 20-oct al 3-nov de 2026. De 10 a 20 microservicios.**
> El tablero del sprint (tareas T-xx y su estado) es el artifact "Tablero Sprint 4" que
> comparte el Product Owner. Las decisiones de la junta del 21-oct ya están en
> `docs/matriz-perfiles-permisos.md` §4 (D-33 a D-47).

## Para el agente de cada integrante (Claude Code u otro)

Si eres un agente trabajando para un integrante, haz esto antes de escribir código:

1. Lee `CLAUDE.md` y los documentos de negocio que lista, en su orden de precedencia.
   Las decisiones D-33 a D-47 (§4.2 de la Matriz, "Sprint 4") **ganan** sobre lo que
   digan los READMEs o el código actual.
2. Averigua para quién trabajas: `git config user.name` y `git config user.email`. Busca
   su nombre en la tabla **"Qué le toca a cada quien"** de abajo. Trabaja **solo** en sus
   tareas y en sus carpetas; si algo necesita un servicio de otro, pídelo, no lo escribas.
3. Respeta el orden: **contrato antes que código.** Ningún servicio nuevo se programa sin
   su `docs/contratos/<servicio>.md` + `.xsd` revisados (límite 23-oct) y sin su fila de
   permisos completa en la Matriz §3.2.
4. Lo marcado **PENDIENTE** (P-xx, PR-xx y las celdas "Pendiente" de §3.2) **no se
   implementa**. Repórtalo como hallazgo de especificación y sigue con lo demás. Hoy
   afectan a este sprint: **P-11** (umbral de D-36), **P-12** (D-28 a D-32) y **P-01**
   (rol de la app móvil, para offline-sync).
5. Los servicios nuevos parten de la plantilla actualizada por **T-02** (22-oct): id de
   correlación `X-Correlation-Id` y `GET /v1/health` con el estado de Postgres, Mongo y
   Redis. No copies un servicio existente como base.
6. Antes de abrir el PR, cumple el **gate** de abajo y corre build + unitarias. Commits
   con la cuenta de Git **del integrante**, nunca con otra identidad.

## Qué le toca a cada quien (Sprint 4)

Fechas = límite de la tarea en el tablero. "Depende de" = no empieces antes.

### Juan Angel Galván Navarro (Product Owner)

| Tarea | Qué | Límite | Depende de | Rama |
|---|---|---|---|---|
| T-02 | Plantillas `template-nest` y `template-fastapi`: `X-Correlation-Id` (se genera si no viene, se reenvía a otros servicios, logs y auditoría) y health con dependencias, tiempo de respuesta y versión | 22-oct | — | `feature/plantillas-sprint4` |
| T-04 | Contratos de `transactions-ingestion-service` (3111) y `monitoring-service` (3120) | 23-oct | T-01 | `docs/contratos-ingestion-monitoring` |
| T-18 | auth-service: recuperar contraseña con token de un solo uso en Redis, 15 min, misma respuesta exista o no el correo; al cambiarla se revocan las sesiones (D-45) | 27-oct | — | `feature/auth-service` |
| T-19 | audit-service: guardar el id de correlación y encadenar cada registro con el hash del anterior; ruta que detecte un registro alterado | 28-oct | T-02 | `feature/audit-service` |
| T-20 | notifications-service: preferencias por usuario; los avisos de aprobación pendiente no se pueden apagar (D-46) | 28-oct | — | `feature/notifications-service` |
| T-08 | `transactions-ingestion-service`: lotes CSV/JSON/XML, validación por fila, duplicados (D-34), vista previa, confirmación hacia core-process por HTTP, conciliación (D-33) | 30-oct | T-02, T-04 | `feature/transactions-ingestion-service` |
| T-09 | `monitoring-service`: health de los 20 cada 30 s, degradado/caído según D-44, historial 24 h; solo Administrador | 31-oct | T-02, T-04 | `feature/monitoring-service` |
| T-03 | `infra/docker-compose.yml` con los 20 servicios (3111–3120), sus tablas en `db/schema.sql`, seed en `db/data_retail.sql` y los nuevos en la matriz de `.github/workflows/ci.yml` | 31-oct | T-02, contratos | `feature/infra-sprint4` |

### Pamela Rodríguez de la Rosa

| Tarea | Qué | Límite | Depende de | Rama |
|---|---|---|---|---|
| T-05 | Contratos de `income-segmentation-service` (3112) y `availability-service` (3114) | 23-oct | T-01 | `docs/contratos-segmentacion-disponibilidad` |
| T-21 | catalog-service: alta, cambio y baja de categorías (con productos se desactiva, D-07); búsqueda por texto y filtros en productos, tiendas y zonas, paginada | 27-oct | — | `feature/catalog-service` |
| T-22 | pricing-service: variación de precio de una presentación entre dos fechas, por tienda y por zona, sin promediar presentaciones (D-06) | 28-oct | — | `feature/pricing-service` |
| T-23 | documents-service: exportar CSV con los 16 indicadores (no disponibles con motivo, D-20); permiso y bitácora por descarga (D-46) | 29-oct | — | `feature/documents-service` |
| T-10 | `income-segmentation-service`: segmentos versionados con fuente, clasificación de zonas con su versión, D-10 y D-36 | 30-oct | T-02, T-05 | `feature/income-segmentation-service` |
| T-11 | `availability-service`: existencias por tienda y presentación, cobertura de básicos, faltantes y datos vencidos a los 7 días (D-38) | 30-oct | T-02, T-05 | `feature/availability-service` |

### Leonardo Rangel Castro

| Tarea | Qué | Límite | Depende de | Rama |
|---|---|---|---|---|
| T-06 | Contratos de `basket-analysis-service` (3113), `demand-forecast-service` (3116) y `data-governance-service` (3119) | 23-oct | T-01 | `docs/contratos-canastas-pronostico-gobierno` |
| T-12 | `basket-analysis-service`: canasta típica con el umbral de 20 % (D-37), frecuencia, gasto, mezcla por categoría y comparación entre periodos; lee canastas de core-process por HTTP; grupos chicos no disponibles (D-36) | 30-oct | T-02, T-06 | `feature/basket-analysis-service` |
| T-13 | `demand-forecast-service`: Holt-Winters semanal, 8 semanas, intervalos 80/95 %, MAPE con las últimas 4 semanas, 422 con menos de 12 (D-40); corrida guardada en Mongo (D-47) | 31-oct | T-02, T-06 | `feature/demand-forecast-service` |
| T-14 | `data-governance-service`: fuentes y versiones, linaje, retención y reporte de calidad (D-43) | 31-oct | T-02, T-06 | `feature/data-governance-service` |

### Fernando Olivares del Valle

| Tarea | Qué | Límite | Depende de | Rama |
|---|---|---|---|---|
| T-07 | Contratos de `promotion-service` (3115), `recommendations-workflow-service` (3117) y `offline-sync-service` (3118) | 23-oct | T-01 | `docs/contratos-promocion-seguimiento-sync` |
| T-15 | `promotion-service`: descuento %, paquete y tamaño de empaque con vigencia; propone el Gerente, aprueba el Responsable de precios; precio unitario por kg/L; no toca el histórico (D-39) | 30-oct | T-02, T-07 | `feature/promotion-service` |
| T-16 | `recommendations-workflow-service`: solo recomendaciones aprobadas; Asignada → En implementación → Implementada → Evaluada; fuera de orden → 409 (D-41) | 30-oct | T-02, T-07 | `feature/recommendations-workflow-service` |
| T-17 | `offline-sync-service`: lotes de capturas (JSON del móvil, XML del escritorio), idempotencia por id de dispositivo, conflictos y acuse por captura (D-42) | 31-oct | T-02, T-07, T-11 | `feature/offline-sync-service` |

### Todos

| Tarea | Qué | Límite |
|---|---|---|
| T-24 | Prueba integral con los 20 arriba: importar un lote por ingestion → canastas → canasta típica y pronóstico → promoción → aprobar una recomendación y darle seguimiento → sincronizar capturas → todo visible en monitoreo y en la bitácora con el mismo id de correlación. Sprint review el 3-nov. | 3-nov |

### Consecuencias de las decisiones que todavía no tienen tarea

Las decisiones de la junta mueven responsabilidades entre servicios existentes. El
tablero no tiene tarea para estos cambios; cada dueño los coordina con quien recibe:

| Decisión | Qué cambia | Dueño actual → nuevo |
|---|---|---|
| D-33 | core-process deja de importar archivos (`/v1/transactions/import/*`) cuando ingestion funcione; web (`web/src/api/transacciones.ts`) y escritorio pasan a ingestion | Juan Angel |
| D-35 | catalog entrega `segmentos_ingreso` y `zona_clasificaciones` a income-segmentation; web (`web/src/api/segmentos.ts`) y escritorio (`desktop/src/api/segmentsApi.ts`) cambian de servicio; decision-service lee segmentos por SQL hoy | Pamela → Pamela; avisar a Fernando |
| D-38 | `inventario` pasa de catalog a availability; decision-service lee `inventario` por SQL en accesibilidad | Pamela → Pamela; avisar a Fernando |

## Arquitectura: 20 microservicios + 3 clientes

`api/` queda congelado como fuente de extracción. La web, el móvil y el escritorio son
clientes, no microservicios.

| # | Servicio | Puerto | Responsable | Estado |
|---|---|---|---|---|
| 1 | auth-service | 3101 | Juan Angel | Existente (+T-18) |
| 2 | catalog-service | 3102 | Pamela | Existente (+T-21) |
| 3 | pricing-service | 3103 | Pamela | Existente (+T-22) |
| 4 | core-process-service | 3104 | Juan Angel | Existente |
| 5 | algorithms-core | 3105 | Leonardo | Existente |
| 6 | analytics-stats | 3106 | Leonardo | Existente (FastAPI) |
| 7 | decision-service | 3107 | Fernando | Existente |
| 8 | documents-service | 3108 | Pamela | Existente (+T-23) |
| 9 | notifications-service | 3109 | Juan Angel | Existente (+T-20) |
| 10 | audit-service | 3110 | Juan Angel | Existente (+T-19) |
| 11 | transactions-ingestion-service | 3111 | Juan Angel | Nuevo (T-08) |
| 12 | income-segmentation-service | 3112 | Pamela | Nuevo (T-10) |
| 13 | basket-analysis-service | 3113 | Leonardo | Nuevo (T-12) |
| 14 | availability-service | 3114 | Pamela | Nuevo (T-11) |
| 15 | promotion-service | 3115 | Fernando | Nuevo (T-15) |
| 16 | demand-forecast-service | 3116 | Leonardo | Nuevo (T-13) |
| 17 | recommendations-workflow-service | 3117 | Fernando | Nuevo (T-16) |
| 18 | offline-sync-service | 3118 | Fernando | Nuevo (T-17) |
| 19 | data-governance-service | 3119 | Leonardo | Nuevo (T-14) |
| 20 | monitoring-service | 3120 | Juan Angel | Nuevo (T-09) |

Clientes: `web/` (Pamela, JSON), `mobile/` (Fernando, JSON, todavía sin carpeta) y
`desktop/` (Fernando, XML con XSD). Siguen para el Parcial 3 (27-nov).

## Cómo arrancar un servicio nuevo

**No partas de cero ni de otro servicio: parte de la plantilla** (`services/template-nest/`
o `services/template-fastapi/`, ya con T-02). Declara en tu contrato cuál usas.

```
services/<tu-servicio>/
├── src/                 # o app/ en FastAPI
├── Dockerfile           # desde la plantilla (no inventes otro)
└── README.md            # cómo levantarlo solo + su /v1/health
```

Regla de oro: toca **solo tu carpeta** (`services/<tuyo>/`, `mobile/`, `desktop/` o tu
parte de `web/`). Los archivos compartidos están abajo: avisa antes de tocarlos.

## Archivos compartidos: coordinar antes de tocar

| Archivo | Por qué |
|---|---|
| `infra/docker-compose.yml` | Lo coordina Juan Angel (T-03). 20 servicios + postgres/mongo/redis; un cambio de puerto o variable rompe a todos |
| `.github/workflows/ci.yml` | Matriz de servicios que compilan y corren unitarias en cada PR; los nuevos entran con T-03 |
| Formato de error / logging / health / correlación | Vienen de la plantilla. **No inventes el propio** |
| `docs/contratos/` | JSON + XSD por servicio, antes que el código y antes que los clientes |
| `docs/matriz-perfiles-permisos.md` | Decisiones y permisos. Tu fila de §3.2 la completas tú; una decisión nueva entra en §4 con su ID |
| `db/schema.sql` | Postgres compartido con tablas por dueño: solo agregas TUS tablas, con comentario de dueño |
| `web/src/App.tsx` y `web/src/routes/` | Rutas y mapa de portales (frente web) |
| `web/src/types/index.ts` | Interfaces calcadas de los contratos, no de entidades internas |
| `mobile/` y `desktop/` tipos y clientes HTTP | Un solo cliente por app; móvil JSON exclusivo, escritorio XML exclusivo con XSD |

## Datos

Postgres compartido, `synchronize: false`, `db/schema.sql` fuente de verdad. Solo agregas
las tablas de TU servicio y avisas al equipo para recrear volúmenes. Usos acordados de
MongoDB y Redis: los de `CLAUDE.md` más **D-47** (Mongo: corridas de pronóstico, historial
de monitoreo, lotes de sincronización; Redis: idempotencia, caché, último estado) y
**D-45** (token de recuperación en Redis). Cualquier otro uso es una decisión nueva.

Modelo heredado (no se renegocia):

- Precios, inventario y líneas de venta cuelgan de la **PRESENTACIÓN**, no del producto.
- `transacciones_detalle` guarda `presentacion_id`; el producto sale por join.
- Segmentos por **zona agregada**; nunca inferir ingreso individual (también D-36).
- Toda salida calculada cuelga de una corrida (parámetros + supuestos + filtros).
- Auditoría append-only; cambios en `auditoria_cambios`, no en JSON.
- Los servicios se consultan **por HTTP**, no leyendo tablas ajenas. Un servicio nuevo
  no agrega lecturas SQL a tablas de otro.

## Reglas de permisos y estándar transversal

- JWT validado **más** sesión activa en Redis en cada petición. Sin esa consulta, el
  token no vale aunque firme bien.
- Rutas `/v1/`, mismo cuerpo de error, `GET /v1/health`, logging por operación,
  `X-Correlation-Id` (T-02), Swagger con ejemplos JSON **y** XML.
- Móvil = JSON exclusivo; escritorio = XML exclusivo validado con XSD.
- Nombres de rol con la constante `ROL`, nunca literales. Un cambio de rol o permiso se
  hace en la Matriz (`.md`, la fuente), en `roles.ts` de **todos** los servicios y en
  `db/data_retail.sql`, y se avisa al equipo para el `.docx`.

## Flujo de trabajo paso a paso

### Una sola vez, al empezar

```bash
git clone https://github.com/JuanAPG/retail-platform.git
cd retail-platform

# Que tus commits salgan a TU nombre. El profesor revisa esto.
git config user.name  "Tu Nombre Completo"
git config user.email "tu-correo-de-github@ejemplo.com"
git config --get user.email     # verifica antes del primer commit
```

### Cada vez que empiezas algo

```bash
# 1. Parte SIEMPRE de main actualizado.
git checkout main
git pull origin main

# 2. Crea tu rama con el nombre de tu tarea (ver tablas de arriba)
git checkout -b feature/monitoring-service

# 3. Trabaja. Commits pequeños y frecuentes, no uno gigante al final.
git add services/monitoring-service
git commit -m "feat(monitoring-service): consulta el health de los 20 cada 30 s"

# 4. Sube tu rama (la primera vez con -u; después basta `git push`)
git push -u origin feature/monitoring-service
```

Luego abre el Pull Request en GitHub: **Compare & pull request** → base `main`,
compare tu rama.

### Mantener tu rama al día (cada dos o tres días)

```bash
git checkout main
git pull origin main
git checkout feature/monitoring-service
git merge main
git push
```

Se usa `merge` y no `rebase` a propósito: `rebase` reescribe la historia y obliga a
`push --force`, que si alguien más ya bajó tu rama le destruye el trabajo.

### Después de que aprueben tu PR

```bash
git checkout main
git pull origin main
git branch -d feature/monitoring-service          # borra la local
```

La rama remota se borra sola si está activado *Automatically delete head branches*.

## Gate obligatorio antes de abrir cualquier PR

Si tu frente no cumple esto, el PR se regresa sin revisar:

- El servicio compila y levanta con `docker compose up` sin errores.
- Responde en `/v1/health` con sus dependencias.
- Swagger con ejemplo de petición/respuesta en JSON **y** en XML; el XML valida contra
  su XSD.
- Usa el formato estándar de error y el id de correlación de la plantilla.
- Valida JWT y consulta Redis (sesión activa) en cada petición.
- Al menos una prueba unitaria y una de integración; cada cálculo con su caso de
  control (si el documento no trae uno, lo agregas y lo subes como decisión).
- Apps: contra servicios reales, no mocks. Escritorio: XML real validado con XSD.
- Si tocaste un archivo compartido, lo avisas en la descripción del PR.

"Terminado" para un servicio nuevo, además: contrato `.md` + `.xsd` antes de programar,
fila de permisos en §3.2, solo escribe sus tablas, auditoría y notificaciones sin
bloquear, Dockerfile, en el compose y README.

## Ramas (GitHub Flow)

- `main` siempre desplegable, protegida (requiere PR + 1 aprobación)
- Ramas: `feature/<servicio-o-frente>`, `fix/<tema>` o `docs/<tema>`, en minúsculas con
  guiones
- Se borran al hacer merge
- Actualiza tu rama con `main` cada dos o tres días
- Una rama = un frente = un PR. No mezcles dos frentes en la misma rama

## Commits (Conventional Commits con alcance del servicio)

```
feat(auth-service): recupera la contraseña con token de un solo uso
fix(pricing-service): corrige histórico por presentación
docs: actualiza contratos de catalog-service
chore: agrega Redis a docker-compose
refactor(decision-service): simplifica cálculo de accesibilidad
```

**Cada quien hace commits con su propia cuenta de Git.** Commits atribuidos a otra
identidad, o documentación sin commits de código real, no cuentan como participación.
Verifica con:

```bash
git config user.name && git config user.email
```

## Pull Requests

- Título claro con el frente: `feat(monitoring-service): panel de estado de los 20`
- Descripción de qué y por qué, y cómo probarlo (contra qué servicios y con qué
  usuario/rol, qué debe verse en Swagger en JSON y en XML)
- Ligar el PR a su tarea del tablero (T-xx) y a las decisiones que aplica (D-xx)
- **Mínimo 1 aprobación** antes de mergear a `main`. Nadie aprueba su propio PR
- El CI tiene que pasar en verde

### Al revisar el PR de alguien más

- Descarga la rama y córrela, no solo leas el diff
- Revisa que no haya tocado carpetas de otros frentes ni inventado su propio formato de
  error, versionado, health o correlación
- Revisa que aplique las decisiones que cita y no implemente nada PENDIENTE
- Si agregó tablas, que sean solo las suyas y estén en `db/schema.sql`
- Comenta lo que veas raro; aprobar sin leer no cuenta como participación

## Verificación local y demo end-to-end

```bash
docker compose -f infra/docker-compose.yml up -d
curl localhost:3101/v1/health   # cada servicio en su puerto (3101 a 3120)
```

Demo del Sprint 4: el recorrido de T-24. Demo del Parcial 3 (27-nov): móvil (JSON) →
microservicios + Redis/Mongo/Postgres → web → escritorio (XML) → Swagger.

Si falta tiempo, se recorta en este orden: exportación a Excel (D-19), push real en
móvil, locks en Redis, cobertura fuera de auth/core/algorithms. **No se recorta:**
JSON + XML en todos los servicios, ≥ 4 microservicios por app cliente, Redis en la
autorización de todos, demo de punta a punta.

Front en su puerto Vite, Swagger en cada servicio (`/docs`). Credenciales de prueba en
[README.md](README.md). GCP y Secret Manager, hasta el Parcial 3.
