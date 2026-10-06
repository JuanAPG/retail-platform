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
| Asociación (M10) | `/v1/association/apriori/run`, `/v1/association/runs`, `/v1/association/runs/:id` | migrado: Apriori trasladado sin cambios, corrida completa guardada, `/runs` paginado, JSON y XML, Swagger con ejemplos |
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

`http://localhost:3105/docs` (JSON crudo en `/docs-json`). Cada ruta lleva ejemplo de
respuesta en **JSON y XML** y sus errores estándar. El XML de ejemplo se genera desde el
ejemplo JSON con la misma lógica del `XmlInterceptor` (`src/common/swagger/ejemplos.ts`);
los datos de ejemplo viven en `src/common/swagger/muestras.ts`.

Una ruta nueva se documenta con `@ApiOperation`, `@ApiRespuesta(status, descripcion, ejemplo)`
y `@ApiErrores(...)`; la prueba `test/swagger.spec.ts` falla si falta alguna.

Para probar rutas protegidas: **Authorize** con el `accessToken` de
`POST http://localhost:3101/v1/auth/login` (correr Apriori: Administrador o Analista
comercial; consultar: cualquier perfil interno).

## Docker

- **Desarrollo / demo** (lo usa `infra/docker-compose.yml`): imagen `node:20` con la carpeta
  montada y `npm run start:dev`. Necesita postgres y redis arriba; la primera vez tarda ~1 min
  por el `npm install`.
  ```bash
  docker compose -f infra/docker-compose.yml up -d postgres redis algorithms-core
  ```
  En Windows el contenedor **no recarga solo** al editar el código (los cambios de la carpeta
  montada no le llegan): después de cambiar algo, `docker restart retail_algorithms_core`
  antes de probar.
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
npm test                 # unitarias (*.spec.ts dentro de src/): RolesGuard y Apriori; las corre el CI
npm run test:integracion # integración (test/): requiere el servicio arriba; NO las corre el CI
# contra otro host/puerto (p. ej. la imagen de producción):
ALGORITHMS_BASE_URL=http://localhost:3115 npm run test:integracion
```

- `src/association/apriori.spec.ts`: ejemplo de libro calculado a mano, antecedente como
  conjunto, corrida reproducible y validación de soporte.
- `test/swagger.spec.ts`: cada ruta publica ejemplo JSON y XML y sus errores estándar.

## Datos

Postgres compartido, `synchronize: false`, `db/schema.sql` es la fuente de verdad. Este
servicio solo escribe sus tablas: `analisis_corridas` y sus hijas
(`analisis_corrida_parametros`, `analisis_corrida_supuestos`, `analisis_corrida_filtros`),
`reglas_asociacion`, `regla_asociacion_items`, `reglas_exclusion_asociacion` y
`elasticidades`.

`analisis_corridas` también la escribe decision-service (corridas de accesibilidad), así
que toda consulta de este servicio filtra por `tipo`. Las entidades no tienen relaciones
TypeORM con tablas de otros servicios (`usuarios`, `productos`): solo guardan el id, y la
llave foránea sigue en Postgres.

Lo que lee de otros servicios (canastas de core-process, precios de pricing, catálogo de
catalog, nombres de auth) pasa **solo** por `src/fuente-datos/` (`FuenteDatos`): en Fase B
por SQL de solo lectura, en Fase C por HTTP con las mismas firmas. Detalle en la sección
*Lo que consume algorithms-core* del contrato.
