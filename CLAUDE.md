# Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista

Materia: Integración de Aplicaciones Computacionales. Equipo de 4, metodología SCRUM.
Repo: `JuanAPG/retail-platform` (GitHub, público).

**Sprint actual: Sprint 4, del 20-oct al 3-nov de 2026: de 10 a 20 microservicios.**
Antes de trabajar, lee `CONTRIBUTING.md` → "Para el agente de cada integrante" y "Qué le
toca a cada quien": ahí están las tareas (T-xx), límites y ramas de cada persona. Las
decisiones del sprint son D-33 a D-47 (`docs/matriz-perfiles-permisos.md` §4.2). Las
tablas de abajo describen los 10 servicios existentes; los 10 nuevos (3111–3120) están
en CONTRIBUTING.

Sprint 2+3 (30-sep al 13-oct) se entregó como Parcial 2.

## Antes de tocar código: documentos de negocio

Lee estos archivos antes de decidir permisos, roles, cálculos o reglas. Están
escritos para agentes y revisores.

| Archivo | Qué contiene |
|---|---|
| `docs/matriz-perfiles-permisos.md` | Roles, niveles de permiso, Matriz por módulo y servicio, **decisiones de negocio D1–D3 y D-01 a D-20**, flujos con estado, pendientes P-01 a P-10. |
| `docs/requerimientos.md` | RF-01 a RF-48 y RNF-01 a RNF-10 (texto literal), con servicio responsable y decisión aplicable; requisitos no recortables del Parcial 2. |
| `docs/reglas-negocio.md` | RN-01 a RN-15 (texto literal) con su estado vigente; pendientes PR-1 a PR-8. |
| `docs/contratos/` | Contrato JSON (`*.md`) y XSD por servicio; `paginacion.md`. |
| `services/snippets/error-codes.md` | Códigos de error estándar. |
| `db/schema.sql` | Fuente de verdad del modelo PostgreSQL. |

**Precedencia cuando dos fuentes se contradicen:**

1. Decisiones de negocio (`docs/matriz-perfiles-permisos.md` §4)
2. Matriz de permisos (§3 del mismo archivo)
3. Requerimientos (`docs/requerimientos.md`)
4. Reglas de negocio (`docs/reglas-negocio.md`)
5. Contratos (`docs/contratos/`)
6. READMEs de cada servicio y comentarios en el código

Reglas para agentes:

- Si el código contradice una fuente de mayor precedencia, **gana la fuente** y la
  diferencia se reporta.
- Lo marcado **PENDIENTE** (P-xx, PR-xx) no está decidido: **no lo asumas ni lo
  implementes**. Repórtalo como *hallazgo de especificación* y sigue con lo demás.
- Si una regla de negocio no aparece en ningún documento, pregunta al Product Owner;
  no la inventes.
- Toda decisión nueva se registra en `docs/matriz-perfiles-permisos.md` §4 con su ID.
  El `.docx` de la Matriz es una copia para entregar; la fuente es el `.md`.

## Qué hace el sistema

Analiza cómo varían las canastas de consumo según zona, nivel de ingreso y precio, para
generar recomendaciones comerciales inclusivas. Cadena de negocio central (lo que más
importa, según la retroalimentación del profesor):

```
TRANSACCIONES → CANASTAS → ZONAS + INGRESO → PATRONES DE COMPRA →
ASOCIACIONES → SUSTITUCIÓN → ELASTICIDAD → ACCESIBILIDAD →
SIMULACIÓN → RECOMENDACIONES
```

## Arquitectura: 10 microservicios

| # | Microservicio | Responsabilidad | Origen | Responsable |
|---|---|---|---|---|
| 1 | `auth-service` | Login, JWT, renovación, revocación vía Redis; CRUD de usuarios y roles; alta de proveedores | M01 | Juan Angel |
| 2 | `catalog-service` | Tiendas, Zonas, Productos y Presentaciones, Segmentos; propuestas de producto del Proveedor | M02–M05 | Pamela |
| 3 | `pricing-service` | Precios, histórico, comparación entre zonas; propuestas de precio | M08 | Pamela |
| 4 | `core-process-service` | Transacciones (manual + CSV), canastas, analítica descriptiva | M06 + M07 + M09 | Juan Angel |
| 5 | `algorithms-core` | Apriori, **FP-Growth** (D2), elasticidad, sustitución (TS, sin reescribir) | M10 + M11 | Leonardo |
| 6 | `analytics-stats` | Clustering, hipótesis, ANOVA, proporciones (Python/FastAPI) | Nuevo (RF-16, 20–22) | Leonardo |
| 7 | `decision-service` | Accesibilidad, simulación, escenarios, recomendaciones | M12 + M13 + M14 | Fernando |
| 8 | `documents-service` | Reporte ejecutivo, PDF (Excel después, D-19), historial en MongoDB | M16 (nuevo) | Pamela |
| 9 | `notifications-service` | Notificaciones internas, bandeja, contador | M17 (nuevo) | Juan Angel |
| 10 | `audit-service` | Bitácora inmutable y consultas históricas | M15 | Juan Angel |

Clientes (no son microservicios):

| Cliente | Formato | Responsable | Proceso |
|---|---|---|---|
| `web/` | JSON | Pamela | Sistema web ampliado, consume los 10 servicios. |
| `mobile/` | **JSON exclusivo** | Fernando | Captura de campo: precios, escaneo, disponibilidad, ubicación, encuestas, offline. |
| `desktop/` | **XML exclusivo** (validado con XSD) | Fernando | Análisis: importar ventas, asociaciones, elasticidad, comparar zonas, exportar. No es copia de la web. |

Reglas vigentes:

- `api/` (monolito) es **fuente de extracción congelada**: no recibe features nuevas.
- Contratos primero: no construyas pantallas contra respuestas no acordadas en
  `docs/contratos/`.
- Cada servicio escribe **solo sus tablas** en el Postgres compartido.
- Los servicios se consultan por HTTP, no leyendo tablas ajenas.

## Estándar transversal (obligatorio en los 10)

- Rutas bajo `/v1/` y `GET /v1/health`.
- JWT validado **y** sesión activa en Redis en cada petición. Ningún servicio confía
  solo en la firma del token.
- Respuestas JSON o XML según `Accept`; cada respuesta XML valida contra su XSD.
- Mismo formato de error (código, mensaje, detalle) en JSON y XML.
- Logging por operación, sin tokens ni datos sensibles.
- Swagger con ejemplo JSON y XML, respuestas de éxito y de error.
- Dockerfile propio por servicio.
- Llamadas a `audit-service` y `notifications-service`: **fire-and-forget** con
  timeout corto; si fallan, la operación original igual se completa.

## Datos

- **PostgreSQL 16:** compartido, tablas por dueño; `db/schema.sql` es la fuente de
  verdad. Precios, inventario y ventas apuntan a la **presentación**, no al producto.
- **MongoDB 7** (definido en `infra/docker-compose.yml`). Usos acordados:
  - `documents-service`: historial de reportes (colección `reportes`).
  - `notifications-service`: notificaciones.
  - `algorithms-core` y `analytics-stats`: corridas de Apriori, FP-Growth y
    clustering (D3), con foto de los datos para reproducir (D-15).
- **Redis 7:** sesiones activas, tokens revocados, caché de catálogos, contadores y
  límites de login. **Todos** los servicios lo consultan al autorizar.

Usos nuevos del Sprint 4: **D-47** (Mongo: corridas de pronóstico, historial de
monitoreo, lotes de sincronización; Redis: idempotencia, caché, último estado) y
**D-45** (token de recuperación de contraseña en Redis).

No uses Mongo ni Redis para otra cosa sin acordarlo y registrarlo como decisión.

## Stack

- **Microservicios NestJS (1–5, 7–10):** Node.js + TypeScript + NestJS + TypeORM + `pg`
  + `@nestjs/jwt` + `bcrypt` + `class-validator` / `class-transformer` +
  `@nestjs/swagger` + `@nestjs/config`. Plantilla: `services/template-nest/`.
- **`analytics-stats`:** Python + FastAPI (scikit-learn, scipy, statsmodels).
  Plantilla: `services/template-fastapi/`.
- **Móvil:** Android nativo Kotlin + Retrofit + Room (offline) + cámara (código de
  barras, RF-34) + GPS (RF-37).
- **Escritorio:** Electron + TypeScript.
- **Web:** React + Vite + React Router + axios + Tailwind CSS + Highcharts.
- **Infra local:** Docker Compose (`infra/docker-compose.yml`). Credenciales simples y
  Redis sin auth **a propósito** hasta el despliegue en GCP (Parcial 3). No inventes
  credenciales seguras para local.

## Reglas de negocio que más se rompen

Detalle completo en `docs/matriz-perfiles-permisos.md` §4. Las que más fallan:

- **Precios:** el histórico solo se anexa, nunca se sobrescribe. Solo el
  **Responsable de precios** aprueba precios propuestos (D1). Un precio futuro no
  cambia el vigente hasta su fecha (D-05). No se promedian presentaciones distintas
  (D-06).
- **Catálogo:** con historial, se desactiva y no se borra (D-07). Un producto
  pendiente o rechazado solo lo ven el Gerente y el Proveedor que lo propuso (D-08).
- **Segmentos:** se asignan a la **zona agregada**; nunca se infiere el ingreso de una
  persona. Rangos encimados se rechazan (D-10).
- **Asociaciones:** soporte y confianza en (0, 1], umbral `>=` (D-17). Repetir una
  corrida da el mismo resultado (D-15).
- **Elasticidad:** unitaria si 0.95 ≤ |E| ≤ 1.05 (D-18). Sin variación de precio →
  error claro, nunca `Infinity` ni `NaN`.
- **Simulación de precio:** elasticidad constante (D-01). Caso de control: demanda
  1,000, precio 25 → 27.5, E = −2 → 826 unidades, ingreso −9.1 %.
- **Accesibilidad:** % del ingreso más puntaje 0–1 (D-02); canasta básica de
  referencia oficial (D-03); un básico sin precio se estima y se marca (D-04).
  Siempre por zona; es un indicador analítico, no una medida de bienestar.
- **Recomendaciones:** motor de reglas, sin IA. Genera el Planeador, decide el
  Gerente (D-12). Cada una explica qué, por qué, con qué datos y qué impacto.
- **Reportes:** 16 indicadores; un indicador no disponible sale
  `disponible:false` con motivo, **nunca 0** (D-20).
- **Permisos:** recurso ajeno para quien solo ve lo propio → `404`, no `403`.

## Equipo

| Integrante | Frente |
|---|---|
| Juan Angel Galván Navarro | Product Owner. `auth-service`, `core-process-service`, `notifications-service`, `audit-service`; plantillas, Dockerfiles y docker-compose. |
| Pamela Rodríguez de la Rosa | `catalog-service`, `pricing-service`, `documents-service`; web ampliada. |
| Leonardo Rangel Castro | `algorithms-core`, `analytics-stats`. |
| Fernando Olivares del Valle | `decision-service`; app móvil; app de escritorio. |

Los roles técnicos de Leonardo y Pamela están **intercambiados** respecto al Documento
de Planeación original (sección 5 pendiente de actualizar). Scrum Master rotativo.

## Reglas de trabajo

- Cada quien hace commits con **su propia** cuenta de Git. Commits con otra identidad
  no cuentan como participación (observación del profesor en el Parcial 1).
- Ramas por microservicio: `feature/<servicio>` (orden y dependencias en
  `CONTRIBUTING.md`).
- PR con al menos 1 aprobación antes de mergear a `main`; la rama se borra al mergear.
- Conventional Commits con alcance: `feat(catalog-service): …`.
- La demo corre de principio a fin sin tocar la base de datos a mano: móvil (JSON) →
  microservicio → Redis/Mongo/Postgres → web → escritorio (XML) → Swagger.
- Si falta tiempo, se recorta en este orden: exportación a Excel (D-19), push real en
  móvil, locks en Redis, cobertura fuera de auth/core/algorithms. **No se recorta:**
  JSON + XML en los 10, ≥ 4 microservicios por app cliente, Redis en la autorización
  de todos, demo de punta a punta.

## Al trabajar en este repo

- Parte de la plantilla del servicio; no inventes tu propio formato de error,
  versionado, health ni logging.
- Antes de cambiar un rol o permiso, actualiza `docs/matriz-perfiles-permisos.md`,
  `roles.ts` en **todos** los servicios y `db/data_retail.sql`, y avisa al equipo.
- Los nombres de rol son exactos (con acentos): `Gerente de categoría`,
  `Responsable de precios`, etc. Usa la constante `ROL`, nunca strings sueltos.
- Si un cálculo numérico no tiene caso de control en los documentos, agrega uno en
  las pruebas y súbelo como decisión antes de darlo por correcto.

## Calendario

| Hito | Fecha |
|---|---|
| Parcial 1 | 4-sep (entregado, observaciones corregidas en el monolito) |
| Sprint 2+3 | 30-sep – 13-oct |
| Parcial 2 | 13-oct (entregado) |
| Sprint 4: 20 microservicios | 20-oct – 3-nov |
| Parcial 3 (GCP, Locust, dataset grande) | 27-nov |
| Entrega final | 1-dic |

## Estructura del repo

```
retail-platform/
├── api/                  # Monolito NestJS: fuente de extracción CONGELADA
├── services/
│   ├── auth-service/  catalog-service/  pricing-service/
│   ├── core-process-service/  algorithms-core/  analytics-stats/
│   ├── decision-service/  documents-service/  notifications-service/
│   ├── audit-service/
│   ├── template-nest/  template-fastapi/
│   └── snippets/         # error-codes.md
├── web/                  # React + Vite
├── mobile/               # Android Kotlin (JSON)
├── desktop/              # Electron + TS (XML)
├── infra/docker-compose.yml
├── db/                   # schema.sql, data_retail.sql
├── docs/
│   ├── matriz-perfiles-permisos.md
│   ├── requerimientos.md
│   ├── reglas-negocio.md
│   ├── contratos/        # *.md + *.xsd por servicio
│   ├── modelo-datos/
│   └── design/
├── scripts/
├── CONTRIBUTING.md
└── README.md
```
