# Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista

Materia: Integración de Aplicaciones Computacionales. Equipo de 4, metodología SCRUM.
Repo: `IntegracionProyectoFinal` (GitHub, cuenta personal de Juan Angel, público).

Sprint 2+3 unificado: 30 de septiembre al 13 de octubre de 2026 (14 días corridos,
**sin colchón**). Entrega: Parcial 2. El plan original (Sprint 2 + Sprint 3 con margen)
se consumió rehaciendo el Sprint 1 como monolito modular; este backlog parte de ahí.

## Qué hace el sistema

Analiza cómo varían las canastas de consumo según zona, nivel de ingreso y precio, para
generar recomendaciones comerciales inclusivas. Cadena de negocio central (lo que más
importa, según retroalimentación del profesor):

```
TRANSACCIONES → CANASTAS → ZONAS + INGRESO → PATRONES DE COMPRA →
ASOCIACIONES → SUSTITUCIÓN → ELASTICIDAD → ACCESIBILIDAD →
SIMULACIÓN → RECOMENDACIONES
```

## Decisión arquitectónica vigente: 10 MICROSERVICIOS JUSTIFICADOS

El Parcial 1 rechazó adelantar arquitectura distribuida sin justificarla, y difirió la
decisión de qué extraer hasta este parcial. Ese momento es ahora: cada microservicio
corresponde a un módulo que ya existe o a un RF pendiente — ninguno es relleno.

| # | Microservicio | Responsabilidad | Origen |
|---|---|---|---|
| 1 | `auth-service` | Login, JWT, renovación, revocación vía Redis | M01, se extrae |
| 2 | `catalog-service` | Tiendas, Zonas, Productos y Presentaciones, Segmentos | M02–M05, se combinan |
| 3 | `pricing-service` | Precios, histórico, comparación entre zonas | M08, se extrae |
| 4 | `core-process-service` | Transacciones (manual + CSV) y construcción de canastas | M06+M07, se combinan |
| 5 | `algorithms-core` | Apriori, Elasticidad, Sustitución (TS, **sin reescribir**) | M10+M11, se empaqueta |
| 6 | `analytics-stats` | Clustering, hipótesis, ANOVA, proporciones (RF-16/20/21/22) | Nuevo, Python/FastAPI |
| 7 | `decision-service` | Accesibilidad, Simulación, Recomendaciones | M12+M13+M14, se combinan |
| 8 | `documents-service` | Reportes, PDF/Excel, historial en MongoDB | Nuevo (M16) |
| 9 | `notifications-service` | Notificaciones internas (alta proveedor, cambios de precio) | Nuevo (M17) |
| 10 | `audit-service` | Bitácora y consultas históricas | M15, se extrae |

Reglas vigentes:

- `api/` (monolito) queda como **fuente de extracción congelada**: el código se
  traslada a `services/`, no se duplica ni recibe features nuevas.
- El sistema **web es el cliente** que consume los 10 microservicios, no uno de ellos.
- **Estándar transversal obligatorio** en los 10: rutas `/v1/`, JWT validado contra
  `auth-service` **más** sesión activa en Redis (ningún servicio confía ciegamente en
  el token), respuestas **JSON y XML** según `Accept` (XSD por endpoint XML), mismo
  formato de error, logging por operación, `GET /v1/health`, Swagger con ejemplos en
  ambos formatos, Dockerfile propio por servicio.
- **Contratos primero:** `docs/contratos/` (JSON+XSD por endpoint) se redacta y revisa
  en equipo en Fase A, antes de tocar las apps cliente.

## Stack tecnológico

**Microservicios NestJS (1–5, 7–10):** Node.js + TypeScript + NestJS + TypeORM + `pg` +
`@nestjs/jwt` + `bcrypt` + `class-validator` / `class-transformer` +
`@nestjs/swagger` + `@nestjs/config`. Plantilla común en `feature/infra-estandar`.

**`analytics-stats`:** Python + FastAPI (nuevo, sin código previo que migrar).

**App móvil (JSON exclusivo):** Android nativo **Kotlin** + Retrofit + Room (offline) +
cámara (código de barras, RF-34) + GPS (ubicación de tienda, RF-37). Proceso de
campo: captura e investigación de mercado.

**App de escritorio (XML exclusivo):** **Electron + TypeScript**. Proceso distinto:
análisis y gestión comercial (importar ventas, Apriori, elasticidad, comparar zonas,
validación XSD, exportación inicial). No debe ser una copia de la web.

**Frontend web:** React + Vite + React Router + axios + Tailwind CSS (+ Highcharts en
la ampliación).

**Datos:** PostgreSQL 16 **compartido, tablas por dueño** (cada servicio solo escribe
sus tablas; `db/schema.sql` sigue siendo la fuente de verdad). MongoDB 7 con
operación real: historial de reportes (`documents-service`) y notificaciones
(`notifications-service`) con inserción, consulta, actualización, agregación,
filtrado e índice por fecha/usuario. Redis 7 consultado por **todos** en
autorización: sesiones activas, tokens revocados, caché de catálogos, rate-limit de
login.

**Infra local:** Docker Compose (10 microservicios + postgres, pgadmin, mongodb,
mongo-express, redis). Credenciales hardcodeadas y Redis sin auth **a propósito**:
desarrollo temprano en localhost, no producción. GCP y Secret Manager, hasta el
Parcial 3.

## Equipo y frentes (Sprint 2+3)

| Integrante | Microservicios / frente |
|---|---|
| Juan Angel Galván Navarro | `auth-service`, `core-process-service`, `notifications-service`, `audit-service`; estándar transversal y Dockerfiles de los 10; docker-compose |
| Pamela Rodríguez de la Rosa | `catalog-service`, `pricing-service`, `documents-service`; sistema web ampliado |
| Leonardo Rangel Castro | `algorithms-core`, `analytics-stats` |
| Fernando Olivares del Valle | `decision-service`; app móvil Android; app de escritorio |

Nota: los roles de Leonardo y Pamela están **intercambiados** respecto al plan original
(Leonardo era backend, ahora es algoritmos; Pamela era algoritmos, ahora es backend).
Esto todavía no está actualizado en `Documento_Planeacion_SCRUM.docx`.

Product Owner: Juan Angel. Scrum Master: rotativo por sprint. Fases: A 30/9–2/10
(contratos + plantilla), B 3–6/10 (extracción + Redis + Mongo), C 7–10/10 (apps +
web), D 11–13/10 (pruebas + demo end-to-end). Sin margen entre fases: lo que falte
se resuelve dentro de la siguiente.

## Reglas de trabajo

- Cada quien hace commits con su **propia** cuenta de Git. Commits atribuidos a otra
  identidad, o documentación sin commits de código real, no cuentan como participación
  (esto generó observaciones negativas del profesor en el primer avance).
- Ramas por microservicio: `feature/auth-service`, `feature/catalog-service`, etc.
  (ver tabla y orden con dependencias en CONTRIBUTING.md).
- PR con al menos 1 aprobación antes de mergear a `main`.
- Commits en Conventional Commits con alcance del servicio: `feat(auth-service): …`.
- La demo debe correr de principio a fin sin tocar la base de datos a mano, cruzando
  móvil → microservicio → Redis/Mongo/Postgres → web → escritorio vía XML.
- Si falta tiempo, recortar en este orden: push móvil real, Excel con formato en
  escritorio, locks en Redis, cobertura fuera de auth/core/algorithms. **No se
  recorta:** JSON+XML en los 10, 4+ microservicios por app cliente, Redis en la
  autenticación de todos, demo end-to-end.

## Estructura del repo

```
IntegracionProyectoFinal/
├── api/          # Monolito NestJS — fuente de extracción CONGELADA, no agregar features
├── services/
│   ├── auth-service/
│   ├── catalog-service/
│   ├── pricing-service/
│   ├── core-process-service/
│   ├── algorithms-core/
│   ├── analytics-stats/   # Python/FastAPI
│   ├── decision-service/
│   ├── documents-service/
│   ├── notifications-service/
│   └── audit-service/
├── web/          # Cliente React/Vite (consume los 10 microservicios)
├── mobile/       # App Android Kotlin (JSON exclusivo)
├── desktop/      # App Electron+TS (XML exclusivo)
├── infra/
│   └── docker-compose.yml   # 10 microservicios + postgres/mongo/redis
├── docs/
│   ├── analisis-problema.md
│   ├── requerimientos.md      # RF-01 a RF-48, RNF-01 a RNF-10
│   ├── historias-usuario.md
│   ├── reglas-negocio.md
│   ├── matriz-perfiles-permisos.docx
│   ├── contratos/             # JSON+XSD por endpoint (Fase A, antes que clientes)
│   ├── arquitectura/
│   └── modelo-datos/
├── db/           # schema.sql + data_retail.sql (Postgres compartido)
├── .gitignore
├── README.md
└── CONTRIBUTING.md
```

## Estado actual (inicio Sprint 2+3, 30 sept)

Ya existe y funciona en el monolito (M01–M15, flujo completo demostrado): login,
importar CSV, canastas, asociaciones, elasticidad, accesibilidad, simulación,
recomendaciones, auditoría, más CSV de 100 canastas y dashboard M16.

Pendiente — flujo cruzado a demostrar (Fase D):

```
Móvil (JSON): login → levantar precio (pricing) / registrar venta (core-process)
  → microservicios + Redis/Mongo/Postgres
  → Web: consultar, simular, recomendar
  → Escritorio (XML): importar ventas, Apriori, elasticidad, comparar zonas
```

Detalles de negocio a respetar en el código (heredados del monolito):

- **Transacción:** tiene `tienda`, `fecha`, `total` y `detalles[]` (producto,
  presentación, cantidad, precio_unitario, subtotal). Una canasta = una transacción.
- **Presentaciones:** relación 1-a-muchos con `producto` (ej. 500 g / 250 g / 1 kg), no
  un campo plano. Precios, inventario y líneas de venta apuntan a la PRESENTACIÓN,
  nunca al producto.
- **Segmentos de ingreso:** por zona agregada, nunca inferir el ingreso exacto de una
  persona a partir de su compra individual.
- **Apriori:** debe guardar la corrida completa para poder reproducirla (parámetros,
  supuestos, filtros; antecedente como conjunto, no texto).
- **Elasticidad:** elástica (`|E| > 1`), inelástica (`|E| < 1`), unitaria (`|E| ≈ 1`);
  conservar datos usados, periodo y supuestos.
- **Accesibilidad:** nunca reducirla a "precio bajo". Combina precio + ingreso del
  segmento + disponibilidad + productos básicos; es un indicador analítico, no una
  medida absoluta de bienestar.
- **Recomendaciones:** motor de reglas simple (no IA todavía). Cada recomendación debe
  explicar qué recomienda, por qué, con qué datos y qué impacto estima.
- **Nuevo transversal:** todo endpoint bajo `/v1/`, error estándar, `GET /v1/health`,
  logging por operación, JWT + sesión Redis, dual JSON/XML con XSD.

## Requerimientos

48 RF (RF-01 a RF-48) y 10 RNF (RNF-01 a RNF-10) — ver `docs/requerimientos.md`.
Nuevos en este sprint: RF-16 (clustering), RF-20/21/22 (hipótesis, ANOVA,
proporciones), RF-33 a RF-40 (móvil: sesión, cámara, GPS), RF-42 a RF-48
(escritorio: proceso de análisis en XML), RF-29 (PDF/Excel en `documents-service`).

## Calendario

| Hito | Fecha |
|---|---|
| Parcial 1 | 4 sept (entregado, con observaciones corregidas en monolito) |
| Sprint 2+3 (backlog unificado) | 30 sept – 13 oct |
| Parcial 2 | 13 oct |
| Parcial 3 | 27 nov |
| Entrega final | 1 dic |

## Al trabajar en este repo

- Si vas a tocar un microservicio, revisa primero si ya existe en `services/` y parte
  de la plantilla `feature/infra-estandar`; no inventes tu propio formato de error,
  versionado, health ni logging.
- Los contratos (`docs/contratos/`) se escriben antes que los clientes: no construyas
  pantallas contra respuestas no acordadas.
- Móvil consume JSON exclusivo; escritorio, XML exclusivo validado con XSD. No los
  mezcles ni hagas una copia de la otra.
- Cada servicio escribe solo sus tablas en el Postgres compartido; Mongo y Redis
  tienen los usos fijados arriba, no los uses para otra cosa sin acordarlo.
- No inventes credenciales seguras para local: seguimos con las simples de
  `infra/docker-compose.yml` hasta el despliegue en GCP.
- Cualquier cambio a la matriz de perfiles y permisos debe reflejarse también en
  `docs/matriz-perfiles-permisos.docx` (no se edita por Claude Code, avisar al equipo).
