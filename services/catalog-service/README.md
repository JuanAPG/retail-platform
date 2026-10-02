# catalog-service

Catálogos de la plataforma: tiendas, zonas/municipios, productos y presentaciones, y
segmentos de ingreso (M02–M05, extraídos del monolito `api/`). Puerto **3102**.
Contrato: [`docs/contratos/catalog-service.md`](../../docs/contratos/catalog-service.md) y `.xsd`.

Parte de la plantilla `template-nest` (health, error estándar, logging, XML por `Accept`,
`SessionGuard` con JWT + Redis); eso **no se modifica**. Aquí se agregan solo los módulos
de negocio.

## Estado de la migración

| Módulo | Rutas | Estado |
|---|---|---|
| Segmentos (M05) | `/v1/segments` | migrado (sin auditoría, pendiente) |
| Tiendas (M02) | `/v1/stores` | migrado (sin auditoría, pendiente) |
| Zonas y municipios (M03) | `/v1/zones`, `/v1/municipalities` | migrado (sin auditoría, pendiente) |
| Productos y presentaciones (M04) | `/v1/products`, `/v1/presentations`, `/v1/product-categories`, `/v1/units`, `/v1/providers` | migrado (sin auditoría, pendiente) |

## Levantarlo solo

Requiere Postgres con `db/schema.sql` aplicado y Redis (ver `infra/docker-compose.yml`).

```bash
npm install
cp .env.example .env     # PORT=3102, DB_* y REDIS_* de localhost
npm run start:dev
curl localhost:3102/v1/health
```

Swagger en `http://localhost:3102/docs`.

## Pruebas

```bash
npm test                 # unitarias
npm run test:integracion # integración (contra Postgres y Redis reales)
```

## Datos

Postgres compartido, `synchronize: false`, `db/schema.sql` es la fuente de verdad. Este
servicio solo escribe las tablas de catálogo (`tiendas`, `zonas`, `productos`,
`producto_presentaciones`, `segmentos_ingreso`, …).
