# algorithms-core

Algoritmos de la plataforma: reglas de asociación con Apriori (M10), elasticidad
precio-demanda y patrones de sustitución (M11), extraídos del monolito `api/` sin
reescribirlos. Puerto **3105**.
Contrato: [`docs/contratos/algorithms-core.md`](../../docs/contratos/algorithms-core.md) y `.xsd`.

Parte de la plantilla `template-nest` (health, error estándar, logging, XML por `Accept`,
`SessionGuard` con JWT + Redis); eso **no se modifica**. Aquí se agregan solo los módulos
de negocio.

## Estado de la migración

| Módulo | Rutas | Estado |
|---|---|---|
| Base del servicio | `/v1/health` | listo: Postgres, roles (`RolesGuard`, `@Roles`, `@CurrentUser`) y jest |
| Asociación (M10) | `/v1/association/apriori/run`, `/v1/association/runs`, `/v1/association/runs/:id` | pendiente (Fase B) |
| Elasticidad (M11) | `/v1/elasticity/calculate`, `/v1/elasticity/chart`, `/v1/elasticity/current` | pendiente (Fase B) |
| Sustitución (M11) | `/v1/substitution/patterns` | pendiente (Fase B) |

## Levantarlo solo

Requiere Postgres con `db/schema.sql` aplicado y Redis (ver `infra/docker-compose.yml`).

```bash
npm install
cp .env.example .env     # PORT=3105, DB_* y REDIS_* de localhost
npm run start:dev
curl localhost:3105/v1/health
curl -H 'Accept: application/xml' localhost:3105/v1/health
```

## Swagger

`http://localhost:3105/docs` (JSON crudo en `/docs-json`). Para probar rutas protegidas:
**Authorize** con el `accessToken` de `POST http://localhost:3101/v1/auth/login`.

## Docker

- **Desarrollo / demo** (lo usa `infra/docker-compose.yml`): imagen `node:20` con la carpeta
  montada y `npm run start:dev`. Necesita postgres y redis arriba; la primera vez tarda ~1 min
  por el `npm install`.
  ```bash
  docker compose -f infra/docker-compose.yml up -d postgres redis algorithms-core
  ```
- **Producción** (GCP, Parcial 3): el `Dockerfile` de esta carpeta, multi-etapa; arranca con
  `node dist/main.js` y solo dependencias de producción. El `.dockerignore` evita enviar
  `node_modules` al contexto de build.
  ```bash
  docker build -t algorithms-core .
  docker run --network retail-platform_retail_net -p 3105:3105 -e PORT=3105 \
    -e SERVICE_NAME=algorithms-core -e JWT_ACCESS_SECRET=dev_access_secret_solo_para_local \
    -e REDIS_HOST=redis -e DB_HOST=postgres -e DB_USER=retail_user \
    -e DB_PASSWORD=retail_pass_2026 -e DB_NAME=retaildb algorithms-core
  ```

## Pruebas

```bash
npm test                 # unitarias (*.spec.ts dentro de src/)
npm run test:integracion # integración (Fase D): requiere el servicio, auth, Postgres y Redis arriba
```

## Datos

Postgres compartido, `synchronize: false`, `db/schema.sql` es la fuente de verdad. Este
servicio solo escribe sus tablas: `analisis_corridas` y sus hijas
(`analisis_corrida_parametros`, `analisis_corrida_supuestos`, `analisis_corrida_filtros`),
`reglas_asociacion`, `regla_asociacion_items`, `reglas_exclusion_asociacion` y
`elasticidades`.

Lo que lee de otros servicios (canastas de core-process, precios de pricing, catálogo de
catalog) está en la sección *Lo que consume algorithms-core* del contrato: en Fase B por
SQL de solo lectura, en Fase C por HTTP.
