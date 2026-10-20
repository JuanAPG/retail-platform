# Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista

Proyecto 10 · Integración de Aplicaciones Computacionales · Universidad de Monterrey

La plataforma analiza cómo cambian las canastas de consumo según la zona, el nivel de
ingreso y el precio, para proponer recomendaciones comerciales inclusivas. Su cadena de
negocio es:

```
TRANSACCIONES → CANASTAS → ZONAS + INGRESO → PATRONES DE COMPRA → ASOCIACIONES →
SUSTITUCIÓN → ELASTICIDAD → ACCESIBILIDAD → SIMULACIÓN → RECOMENDACIONES
```

## Estado

| Parcial | Fecha | Contenido |
|---|---|---|
| Primer Parcial | 4-sep-2026 | Monolito NestJS (`api/`) con la cadena de negocio completa. Hoy está congelado como fuente de extracción. |
| Segundo Parcial | 13-oct-2026 | 10 microservicios con JSON y XML, JWT + Redis, MongoDB, Swagger, Docker y sistema web ampliado. |
| Tercer Parcial | 27-nov-2026 | 20 microservicios, app móvil, app de escritorio, despliegue en GCP y pruebas de carga con Locust. |

## Arquitectura

10 microservicios con responsabilidad única, un cliente web y tres almacenes:
PostgreSQL 16 (compartido, cada tabla tiene un solo servicio dueño), MongoDB 7 y Redis 7.

| Servicio | Puerto | Responsabilidad | Tecnología |
|---|---|---|---|
| `auth-service` | 3101 | Login, JWT, renovación y revocación en Redis; usuarios, roles y proveedores | NestJS |
| `catalog-service` | 3102 | Zonas, segmentos de ingreso, tiendas, productos y presentaciones | NestJS |
| `pricing-service` | 3103 | Precios por presentación y tienda, histórico, comparación entre zonas, propuestas | NestJS |
| `core-process-service` | 3104 | Transacciones (manual y CSV), canastas e indicadores descriptivos | NestJS |
| `algorithms-core` | 3105 | Apriori, FP-Growth, elasticidad y sustitución | NestJS |
| `analytics-stats` | 3106 | Clustering, pruebas de hipótesis, ANOVA y proporciones | FastAPI |
| `decision-service` | 3107 | Accesibilidad, simulación de precio y empaque, recomendaciones | NestJS |
| `documents-service` | 3108 | Reporte ejecutivo con 16 indicadores e historial en MongoDB | NestJS |
| `notifications-service` | 3109 | Notificaciones internas, bandeja y contador | NestJS |
| `audit-service` | 3110 | Bitácora inmutable de eventos | NestJS |

Cada servicio tiene su contrato en `docs/contratos/` y su Swagger en
`http://localhost:<puerto>/docs`.

### Estándar común a los 10

- Rutas bajo `/v1/` y `GET /v1/health`.
- En cada petición se valida el JWT **y** que la sesión siga activa en Redis
  (`session:{userId}`, `revoked:{jti}`). Si Redis no responde: `503`, nunca acceso abierto.
- Respuesta JSON o XML según el header `Accept`; cada XML valida contra su XSD.
- Error estándar en JSON y XML: `{ statusCode, message, code, details, path, timestamp }`.
- Paginación `{ data, total, page, limit }` (`docs/contratos/paginacion.md`).
- Llamadas a `audit-service` y `notifications-service` sin bloquear: si fallan, la
  operación original se completa igual.

### Clientes

| Cliente | Carpeta | Formato | Estado |
|---|---|---|---|
| Sistema web (React + Vite + Highcharts) | `web/` | JSON | Funcional, consume los 10 servicios |
| App móvil (Kotlin + Retrofit + Room) | `mobile/` | JSON | En construcción (Parcial 3) |
| App de escritorio (Electron + TS) | `desktop/` | XML validado con XSD | En construcción (Parcial 3) |

## Levantar el entorno local

Requisitos: Docker y Docker Compose.

```bash
# desde la raíz del repositorio
docker compose -f infra/docker-compose.yml up -d

# verificar
docker compose -f infra/docker-compose.yml ps
curl http://localhost:3101/v1/health
```

El esquema (`db/schema.sql`) y los datos de prueba (`db/data_retail.sql`) se cargan solos
la primera vez que se crea el volumen de PostgreSQL. Para empezar de cero:

```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d
```

| Qué | Dónde |
|---|---|
| Sistema web | http://localhost:5173 |
| Microservicios | http://localhost:3101 a 3110 (Swagger en `/docs`) |
| pgAdmin | http://localhost:5050 |
| mongo-express | http://localhost:8081 |

### Usuarios de prueba

Todos usan la contraseña `Passw0rd123!` (credenciales simples a propósito, solo para
local; se protegen antes del despliegue en GCP).

| Correo | Perfil |
|---|---|
| `admin@retail.mx` | Administrador |
| `analista@retail.mx` | Analista comercial |
| `gercategoria@retail.mx` | Gerente de categoría |
| `precios@retail.mx` | Responsable de precios |
| `planeador@retail.mx` | Planeador |
| `auditor@retail.mx` | Auditor |
| `contacto@bioorganicos.mx` | Proveedor |
| `ventas@lacteosdelnorte.mx` | Proveedor |

## Pruebas

```bash
# unitarias de un servicio NestJS (sin stack)
cd services/<servicio> && npm test

# integración contra el stack real (con docker compose arriba)
cd services/<servicio> && npm run test:integracion

# analytics-stats
cd services/analytics-stats && pytest

# e2e del sistema web
cd web && npm run test:e2e

# XML real contra los XSD
CORE_TOKEN=<jwt> scripts/validate-xml.sh
```

## Estructura del repositorio

```
retail-platform/
├── api/                 Monolito del Primer Parcial (congelado)
├── services/            Los 10 microservicios y las plantillas
│   ├── template-nest/   Plantilla NestJS
│   ├── template-fastapi/
│   └── snippets/        error-codes.md
├── web/                 Sistema web
├── mobile/              App Android (Parcial 3)
├── desktop/             App de escritorio (Parcial 3)
├── infra/               docker-compose.yml
├── db/                  schema.sql y data_retail.sql
├── docs/                Requisitos, reglas, matriz, contratos, documentos de entrega
└── scripts/             Utilidades (validación XML)
```

## Documentación

| Documento | Contenido |
|---|---|
| `docs/requerimientos.md` | RF-01 a RF-48 y RNF-01 a RNF-10 |
| `docs/reglas-negocio.md` | Reglas de negocio RN-01 a RN-15 |
| `docs/matriz-perfiles-permisos.md` | Roles, permisos por módulo y decisiones de negocio |
| `docs/contratos/` | Contrato JSON y XSD de cada servicio |
| `docs/Documento_Tecnico_Parcial2.docx` | Documento técnico consolidado del Segundo Parcial |
| `docs/Fichas_Microservicios_Parcial2.docx` | Ficha de cada microservicio |
| `docs/Diseno_Datos_Parcial2.docx` | Modelo PostgreSQL, MongoDB y Redis |
| `docs/Matriz_Trazabilidad_Parcial2.docx` | Requisito → código → prueba → evidencia |
| `docs/Plan_Pruebas_Parcial2.docx` | Plan y resultados de pruebas |
| `VIDEO_DEMO.txt` | Enlace al video de la demostración |

Cuando dos fuentes se contradicen, manda este orden: decisiones de negocio
(`matriz-perfiles-permisos.md` §4) → Matriz (§3) → requerimientos → reglas de negocio →
contratos → READMEs y código.

## Equipo

| Integrante | Frente |
|---|---|
| Juan Angel Galván Navarro | Product Owner · auth, core-process, notifications, audit, infraestructura |
| Pamela Rodríguez de la Rosa | catalog, pricing, documents · sistema web |
| Leonardo Rangel Castro | algorithms-core, analytics-stats |
| Fernando Olivares del Valle | decision-service · app móvil · app de escritorio |

Cómo trabajamos (ramas, commits y PR): ver `CONTRIBUTING.md`.
