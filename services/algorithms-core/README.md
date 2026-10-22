# algorithms-core

Algoritmos de la plataforma: reglas de asociación con Apriori y FP-Growth (M10), elasticidad
precio-demanda y patrones de sustitución (M11), extraídos del monolito `api/` sin
reescribirlos. Puerto **3105**.
Contrato: [`docs/contratos/algorithms-core.md`](../../docs/contratos/algorithms-core.md) y `.xsd`.

Parte de la plantilla `template-nest` (health, error estándar, logging, XML por `Accept`,
`SessionGuard` con JWT + Redis); eso **no se modifica**. Aquí se agregan solo los módulos
de negocio.

## Estado de la migración

| Módulo | Rutas | Estado |
|---|---|---|
| Base del servicio | `/v1/health` | listo: Postgres, Redis y MongoDB en el health, roles (`RolesGuard`, `@Roles`, `@CurrentUser`) y jest |
| Asociación (M10) | `/v1/association/apriori/run`, `/v1/association/fpgrowth/run`, `/v1/association/runs`, `/v1/association/runs/:id` | migrado: Apriori y FP-Growth, corrida completa guardada en MongoDB (D3) con la foto de sus datos (D-15), `/runs` paginado, JSON y XML, Swagger con ejemplos |
| Elasticidad (M11) | `/v1/elasticity/calculate`, `/v1/elasticity/chart`, `/v1/elasticity/current` | migrado (#56) |
| Sustitución (M11) | `/v1/substitution/patterns` | migrado (ALG-03) |

## Levantarlo solo

Requiere Postgres con `db/schema.sql` aplicado, Redis y MongoDB (ver `infra/docker-compose.yml`).

```bash
npm install
cp .env.example .env     # PORT=3105, DB_*, REDIS_* y MONGO_URL de localhost
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
`POST http://localhost:3101/v1/auth/login` (correr Apriori o FP-Growth: Analista comercial,
`analista@retail.mx`; calcular elasticidad: Responsable de precios, `precios@retail.mx`;
consultar: cualquier perfil interno).

## Docker

- **Desarrollo / demo** (lo usa `infra/docker-compose.yml`): imagen `node:20` con la carpeta
  montada y `npm run start:dev`. Necesita postgres y redis arriba; la primera vez tarda ~1 min
  por el `npm install`.
  ```bash
  docker compose -f infra/docker-compose.yml up -d postgres redis mongodb algorithms-core
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
npm test                 # unitarias (*.spec.ts dentro de src/); las corre el CI
npm run test:integracion # integración (test/): requiere el stack arriba y ventas cargadas; NO las corre el CI
# contra otro host/puerto (p. ej. la imagen de producción):
ALGORITHMS_BASE_URL=http://localhost:3115 npm run test:integracion
```

- `src/association/apriori.spec.ts`: ejemplo de libro calculado a mano, antecedente como
  conjunto, corrida reproducible y validación de soporte.
- `src/association/fpgrowth.spec.ts`: FP-Growth da lo mismo que Apriori (itemsets y reglas,
  en el mismo orden) en el ejemplo de libro, en el caso de QA (soporte 0.30 sí, 0.31 no) y en
  300 casos al azar con semilla fija; desempate del árbol por id.
- `src/elasticity/elasticity.math.spec.ts` y `elasticity.service.spec.ts`: caso A de QA a
  1e-4, límites de D-18, nacional sobre zona × periodo, precio ponderado, atípica,
  cantidad 0, desborde de la columna, segmento ponderado, `/chart` y `/current`.
- `src/config/zona-horaria.spec.ts`: los días se cortan a medianoche de Monterrey.
- `src/substitution/substitution.spec.ts` y `substitution.service.spec.ts`: las tres pruebas
  sintéticas de QA (sustitución conocida, datos sin relación, otra categoría), la evidencia
  (variación de precio y de frecuencia) con su caso de control y el precio vigente.
- `src/association/association.service.spec.ts`: orden de reglas determinista (ALG-06),
  el mismo que `apriori()`, sin depender del id aleatorio de la regla.
- `test/swagger.spec.ts`: cada ruta publica ejemplo JSON y XML y sus errores estándar.
- `test/apriori.spec.ts`: corridas idénticas devuelven las reglas empatadas en el mismo
  orden. Busca sola un rango de fechas con empate en las ventas cargadas; borra sus corridas.
- `test/fpgrowth.spec.ts`: `fpgrowth/run` y `apriori/run` con los mismos umbrales devuelven
  las mismas reglas, métricas y orden; `algoritmo` queda en la corrida; 403 para el
  Administrador. Borra sus corridas.
- `test/elasticidad.spec.ts`: calculate → chart → current contra una regresión calculada
  aparte desde las ventas crudas (con el tope de la columna y el día de Monterrey fijo en la
  prueba, no leído de `ZONA_HORARIA`), `outdated` tras una corrida posterior, y 403 para el
  Analista. Necesita `postgres`, `redis`, `auth-service` y este servicio arriba, y ventas
  cargadas con alguna entre las 18:00 y las 24:00 locales (p. ej.
  `db/datos_prueba_100_canastas.csv` importado por core-process). Borra las corridas que crea.
- `test/sustitucion.spec.ts`: cada categoría contra una referencia calculada aparte desde las
  canastas crudas (lift, observaciones, periodo y pares completos), y 404/400. Solo lee.
- `test/corridas.spec.ts`: cada corrida deja `ejecutar_corrida` en la bitácora y avisa
  `corrida.terminada` (ALG-10). Necesita además `audit-service`, `notifications-service` y
  `mongodb`. Los eventos de la bitácora se quedan (es append-only).

## Datos

Dos almacenes:

- **MongoDB (D3):** las corridas de Apriori y FP-Growth, en la colección `analysis_runs`
  con `type: "asociacion"` (la misma colección que el clustering de analytics-stats, con
  `type: "clustering"`). Cada documento es la corrida completa: parámetros, supuestos,
  filtros, reglas y la foto de los datos (`snapshot.hash`, SHA-256 de las canastas, D-15).
  El `_id` es un UUID para que el contrato no cambie. Sin Mongo, las rutas de asociación
  responden `503` y el health sale `degraded` (D-25). Código: `src/association/`
  (`corrida-asociacion.schema.ts`, `corridas-asociacion.repository.ts`).
- **Postgres compartido**, `synchronize: false`, `db/schema.sql` es la fuente de verdad.
  Este servicio solo escribe sus tablas: `analisis_corridas` y sus hijas
  (`analisis_corrida_parametros`, `analisis_corrida_supuestos`,
  `analisis_corrida_filtros`) para las corridas de elasticidad,
  `reglas_exclusion_asociacion` (RN-10) y `elasticidades`.

`analisis_corridas` también la escribe decision-service (corridas de accesibilidad, D-27),
así que toda consulta de este servicio filtra por `tipo`. Las entidades no tienen relaciones
TypeORM con tablas de otros servicios (`usuarios`, `productos`): solo guardan el id, y la
llave foránea sigue en Postgres.

Lo que lee de otros servicios (canastas de core-process, precios de pricing, catálogo de
catalog, nombres de auth) pasa **solo** por `src/fuente-datos/` (`FuenteDatos`): en Fase B
por SQL de solo lectura, en Fase C por HTTP con las mismas firmas. Detalle en la sección
*Lo que consume algorithms-core* del contrato.
