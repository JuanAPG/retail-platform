# Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista

Materia: Integración de Aplicaciones Computacionales. Equipo de 4, metodología SCRUM.
Repo: `IntegracionProyectoFinal` (GitHub, cuenta personal de Juan Angel, público).

## Qué hace el sistema

Analiza cómo varían las canastas de consumo según zona, nivel de ingreso y precio, para
generar recomendaciones comerciales inclusivas. Cadena de negocio central (lo que más
importa, según retroalimentación del profesor):

```
TRANSACCIONES → CANASTAS → ZONAS + INGRESO → PATRONES DE COMPRA →
ASOCIACIONES → SUSTITUCIÓN → ELASTICIDAD → ACCESIBILIDAD →
SIMULACIÓN → RECOMENDACIONES
```

## Decisión arquitectónica vigente: MONOLITO, no microservicios todavía

El primer avance fue rechazado por adelantar arquitectura distribuida (`auth-service`,
microservicios) antes de tener el problema de negocio resuelto. Regla actual:

- Todo el backend vive en **un solo proyecto NestJS**, organizado en módulos (no
  microservicios): `TransactionsModule`, `BasketsModule`, `ZonesModule`,
  `SegmentsModule`, `PricesModule`, `AnalyticsModule`, `ElasticityModule`,
  `AccessibilityModule`, `SimulationModule`, `RecommendationsModule`, `AuditModule`.
- **No crear microservicios nuevos** ni renombrar módulos como `*-service` hasta que el
  monolito esté completo y estable. La extracción a microservicios se decide hasta el
  Parcial 2 (Sprint 3, 3–13 oct), y solo para los módulos que lo justifiquen.
- App móvil (Android) y app de escritorio: pospuestas, no se tocan hasta Sprint 3.

## Stack tecnológico

**Backend (monolito):** Node.js + TypeScript + NestJS + TypeORM + `pg` (PostgreSQL) +
`@nestjs/jwt` + Passport + `bcrypt` + `class-validator` / `class-transformer` +
`@nestjs/swagger` + `@nestjs/config`.

**Frontend:** React + Vite + React Router + axios + Tailwind CSS.

**Datos:** PostgreSQL 16. **Decisión vigente (revisión del esquema v3): TODO el modelo
analítico vive en PostgreSQL** — canastas, indicadores, corridas, Apriori, elasticidad,
sustitución, accesibilidad y simulación. El dashboard vence antes que el Parcial 2 y
partir el modelo entre dos bases lo obligaría a unir resultados en memoria, sin
integridad referencial. MongoDB 7 (encuestas, catálogos flexibles, bitácora) y Redis 7
(caché de sesiones y precios) se evalúan hasta el Parcial 2, y solo para lo que lo
justifique.

**Infra local:** Docker Compose (servicios: postgres, pgadmin, mongodb, mongo-express,
redis, api, web). Credenciales hardcodeadas y Redis sin auth **a propósito**: es entorno
de desarrollo temprano en localhost, no producción. Antes de GCP (Parcial 3) esto se
mueve a Secret Manager y Redis lleva `requirepass`.

**Nube (a partir de Parcial 3):** GCP — VPC con subredes pública (Load Balancer) y
privadas (Cloud Run/GKE, Cloud SQL, Memorystore), CI/CD con GitHub Actions +
Artifact Registry.

**Futuro (cuando se extraigan microservicios):** Python + FastAPI para los servicios de
algoritmos (Apriori, FP-Growth, clustering, pruebas estadísticas).

## Equipo y roles técnicos (vigentes desde Sprint 1 revisado)

| Integrante | Rol técnico | Módulos de este sprint |
|---|---|---|
| Juan Angel Galván Navarro | Arquitectura, DevOps, Seguridad (+ desarrollo) | Transacciones + importación CSV, Auditoría, refactor a monolito modular |
| Pamela Rodríguez de la Rosa | Backend Web y Microservicios Core | Tiendas, Zonas, Productos y presentaciones, Segmentos, Precios |
| Leonardo Rangel Castro | Datos y Algoritmos | Analítica descriptiva, Apriori, Elasticidad, sustitución |
| Fernando Olivares del Valle | Aplicaciones Cliente (temporal en análisis aplicado) | Canastas, Accesibilidad, Simulación, Recomendaciones |

Nota: los roles de Leonardo y Pamela están **intercambiados** respecto al plan original
(Leonardo era backend, ahora es algoritmos; Pamela era algoritmos, ahora es backend).
Esto todavía no está actualizado en `Documento_Planeacion_SCRUM.docx`.

Product Owner: Juan Angel. Scrum Master: rotativo por sprint. Sprints de 2 semanas.

## Reglas de trabajo

- Cada quien hace commits con su **propia** cuenta de Git. Commits atribuidos a otra
  identidad, o documentación sin commits de código real, no cuentan como participación
  (esto generó observaciones negativas del profesor en el primer avance).
- Cada integrante construye backend **y** su pantalla de frontend correspondiente.
- Ramas por módulo: `feature/m06-transacciones`, `feature/m07-canastas`, etc.
- PR con al menos 1 aprobación antes de mergear a `main`.
- Commits en Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.
- La demo debe correr de principio a fin sin tocar la base de datos a mano.

## Estructura del repo

```
IntegracionProyectoFinal/
├── api/          # Backend NestJS (monolito modular)
├── web/          # Frontend React/Vite
├── mobile/       # App Android — pospuesta hasta Sprint 3
├── desktop/      # App de escritorio — pospuesta hasta Sprint 3
├── services/     # Microservicios — no existen todavía, no crear aún
├── infra/
│   └── docker-compose.yml
├── docs/
│   ├── analisis-problema.md
│   ├── requerimientos.md      # RF-01 a RF-48, RNF-01 a RNF-10
│   ├── historias-usuario.md
│   ├── reglas-negocio.md
│   ├── matriz-perfiles-permisos.docx
│   ├── arquitectura/
│   └── modelo-datos/
├── .gitignore
├── README.md
└── CONTRIBUTING.md
```

## Estado actual (Sprint 1 revisado, 5–18 sept)

Ya existe y es estable: autenticación JWT + control de acceso por rol, y toda la
documentación base (análisis, requerimientos, reglas de negocio, diseño de datos).

Pendiente este sprint — flujo obligatorio a demostrar sin tocar la BD manualmente:

```
Login → Importar transacciones (CSV) → Validar → Almacenar en PostgreSQL →
Construir canastas → Clasificar por zona/segmento → Calcular indicadores →
Identificar asociaciones → Calcular elasticidad → Calcular accesibilidad →
Crear escenario → Modificar precio/empaque → Simular → Comparar escenarios →
Generar recomendación → Registrar auditoría
```

Detalles importantes de negocio a respetar en el código:

- **Transacción:** tiene `tienda`, `fecha`, `total` y `detalles[]` (producto,
  presentación, cantidad, precio_unitario, subtotal). Una canasta = una transacción.
- **Presentaciones:** relación 1-a-muchos con `producto` (ej. 500 g / 250 g / 1 kg), no
  un campo plano. Ya implementado: tabla `producto_presentaciones`. Precios, inventario
  y líneas de venta apuntan a la PRESENTACIÓN, nunca al producto.
- **Segmentos de ingreso:** por zona agregada, nunca inferir el ingreso exacto de una
  persona a partir de su compra individual.
- **Apriori:** debe guardar la corrida completa para poder reproducirla. Ya modelado:
  `analisis_corridas` + `analisis_corrida_parametros` + `_supuestos` + `_filtros`. El
  antecedente de una regla es un conjunto de productos (`regla_asociacion_items`), no
  un campo de texto.
- **Elasticidad:** clasificar como elástica (`|E| > 1`), inelástica (`|E| < 1`) o
  unitaria (`|E| ≈ 1`); conservar datos usados, periodo y supuestos.
- **Accesibilidad:** nunca reducirla a "precio bajo". Combina precio + ingreso del
  segmento + disponibilidad + productos básicos. Documentar que es un indicador
  analítico, no una medida absoluta de bienestar.
- **Recomendaciones:** motor de reglas simple (no IA todavía). Cada recomendación debe
  explicar qué recomienda, por qué, con qué datos y qué impacto estima.

## Requerimientos

48 RF (RF-01 a RF-48) y 10 RNF (RNF-01 a RNF-10) — ver `docs/requerimientos.md`.
Los más recientes que cambian el modelo de datos: RF-35 (presentaciones como tabla
relacionada), RF-12 (flujo de Proveedor con aprobación de Gerente de categoría), RF-15
(soporte/confianza configurables en Apriori/FP-Growth), RF-29 (exportar PDF/Excel).

## Calendario

| Hito | Fecha |
|---|---|
| Parcial 1 | 4 sept (ya entregado, con observaciones) |
| Parcial 2 | 13 oct |
| Parcial 3 | 27 nov |
| Entrega final | 1 dic |

## Al trabajar en este repo

- Si vas a tocar un módulo, revisa primero si ya existe dentro de `api/src/` como
  módulo NestJS antes de crear uno nuevo.
- No propongas separar nada en microservicio independiente todavía, aunque parezca
  "más limpio" — es una decisión de equipo ya tomada y pospuesta a propósito.
- No inventes credenciales seguras para local: seguimos con las simples de
  `infra/docker-compose.yml` hasta el despliegue en GCP.
- Cualquier cambio a la matriz de perfiles y permisos debe reflejarse también en
  `docs/matriz-perfiles-permisos.docx` (no se edita por Claude Code, avisar al equipo).
