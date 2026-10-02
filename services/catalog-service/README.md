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

## Swagger

`http://localhost:3102/docs` (JSON crudo en `/docs-json`). Cada ruta lleva ejemplo de
respuesta en **JSON y XML** y sus errores estándar. El XML de ejemplo se genera desde el
ejemplo JSON con la misma lógica del `XmlInterceptor` (`src/common/swagger/ejemplos.ts`),
así que no se escribe a mano. Los datos de ejemplo viven en `src/common/swagger/muestras.ts`.

Una ruta nueva se documenta con `@ApiOperation`, `@ApiRespuesta(status, descripcion, ejemplo)`
y `@ApiErrores(...)`; la prueba `test/swagger.spec.ts` falla si falta alguna.

Para probar rutas protegidas desde Swagger: **Authorize** con el `accessToken` de
`POST http://localhost:3101/v1/auth/login`.

## Docker

- **Desarrollo / demo** (lo usa `infra/docker-compose.yml`): imagen `node:20` con la carpeta
  montada y `npm run start:dev`. Necesita postgres y redis arriba; la primera vez tarda ~1 min
  por el `npm install`.
  ```bash
  docker compose -f infra/docker-compose.yml up -d catalog-service
  ```
- **Producción** (GCP, Parcial 3): el `Dockerfile` de esta carpeta, multi-etapa; arranca con
  `node dist/main.js`. El `.dockerignore` evita enviar `node_modules` al contexto de build.
  ```bash
  docker build -t catalog-service .
  docker run --network <red-de-compose> -p 3102:3102 -e PORT=3102 -e SERVICE_NAME=catalog-service \
    -e JWT_ACCESS_SECRET=... -e REDIS_HOST=redis -e DB_HOST=postgres -e DB_USER=... \
    -e DB_PASSWORD=... -e DB_NAME=retaildb catalog-service
  ```

## Pruebas

```bash
npm test                 # unitarias
npm run test:integracion # integración: requiere el servicio, Postgres y Redis arriba
# contra otro host/puerto (p. ej. la imagen de producción en el 3112):
CATALOG_BASE_URL=http://localhost:3112 npm run test:integracion
```

## Datos

Postgres compartido, `synchronize: false`, `db/schema.sql` es la fuente de verdad. Este
servicio solo escribe las tablas de catálogo (`tiendas`, `zonas`, `productos`,
`producto_presentaciones`, `segmentos_ingreso`, …).
