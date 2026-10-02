# pricing-service

Precios de la plataforma (M08, extraído del monolito `api/`): registro de precios con
**histórico versionado** por presentación y tienda, consulta del historial y comparación
del precio vigente entre zonas. Puerto **3103**.
Contrato: [`docs/contratos/pricing-service.md`](../../docs/contratos/pricing-service.md) y `.xsd`.

Parte de la plantilla `template-nest` (health, error estándar, logging, XML por `Accept`,
`SessionGuard` con JWT + Redis); eso **no se modifica**. Aquí se agregan solo los módulos
de negocio.

## Rutas

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/prices` | Administrador, Responsable de precios |
| GET | `/v1/prices/history?productId=&presentationId=` | Los 6 perfiles internos (paginado) |
| GET | `/v1/prices/compare-zones?productId=` | Los 6 perfiles internos (agregado, sin paginar) |
| POST | `/v1/price-proposals` | Proveedor |
| GET | `/v1/price-proposals?status=` | Proveedor (solo las suyas), Administrador, Gerente de categoría, Responsable de precios, Auditor |
| PATCH | `/v1/price-proposals/:id/approve` | Administrador, Gerente de categoría |
| PATCH | `/v1/price-proposals/:id/reject` | Administrador, Gerente de categoría |

Reglas que conviene tener presentes:

- El precio cuelga de **presentación + tienda** (RN-06); la zona se deriva de la tienda.
- **El histórico no se sobrescribe**: un precio nuevo cierra el vigente (`effectiveUntil` = un día
  antes) en la misma transacción. No se permite registrar con fecha igual o anterior al vigente (409).
- Este servicio solo escribe `precios`. Presentaciones, tiendas y zonas son de `catalog-service`
  y aquí se **leen por SQL** (sin mapearlas como entidades).

## Estado

| Alcance | Estado |
|---|---|
| Registro, historial y comparación por zonas | migrado |
| Auditoría del alta de precios (a `audit-service`) | migrado |
| Caché en Redis del historial y la comparación por zonas | migrado |
| Propuestas de precio del Proveedor (RN-14) | migrado, con decisiones por confirmar (abajo) |
| Notificaciones de propuestas y cambios de precio | pendiente (`notifications-service`) |

## Auditoría

Cada alta exitosa de un precio se reporta a `audit-service` (`AUDIT_SERVICE_URL`, puerto 3110) con el
precio anterior y el nuevo, el actor y la IP (`src/common/audit/audit-reporter.service.ts`, el mismo
reporter de `auth-service`). El reporte **nunca rompe** el alta: si `audit-service` no responde, el
precio se registra igual. Historial de un precio:
`GET http://localhost:3110/v1/auditoria?tabla=precios&registroId=<id>`.

## Propuestas de precio del Proveedor (RN-14)

Un Proveedor propone un precio para una presentación de **su** producto (activo); alguien interno lo
aprueba o rechaza. Al aprobar, quien aprueba **elige las tiendas** (`storeIds`) y la fecha: el precio
entra a `precios` con `origen = propuesta_proveedor_aprobada`, cerrando el vigente de cada tienda
(reusa `PricesService.registrarPrecio`). Es **todo o nada** en una transacción, y dos revisores
simultáneos no se pisan (el segundo recibe 409). El Proveedor ve sus propuestas y, si se rechazan, el motivo.

**Decisiones por confirmar con el equipo** (RN-14 no está en el repo; cada una es fácil de cambiar):

| Decisión actual | Dónde cambiarla |
|---|---|
| Aprueban Administrador y Gerente de categoría | constante `APRUEBAN_PRECIOS` en `src/common/roles.ts` |
| La propuesta no trae tienda; quien aprueba la elige | `ApprovePriceProposalDto` y `PriceProposalsService.approve` |
| El precio propuesto es de **venta** (entra a `precios`), no costo de compra | contrato; `unidad_compra` solo es informativo |
| Una propuesta pendiente por presentación y proveedor | `PriceProposalsService.create` |

## Caché en Redis

Se cachean `GET /v1/prices/history` y `GET /v1/prices/compare-zones` (prefijo `pricing:`, TTL 5 min).
Todo lo cacheado de un producto cuelga de una **versión** (`pricing:v:<productId>`): cada precio nuevo
(alta directa o aprobación de propuesta) la sube, así que la respuesta **nunca es anterior a un precio ya
registrado**; las llaves viejas caducan solas. El TTL acota lo que la versión no ve (cambios de
`catalog-service`: renombrar una tienda o zona, mover una tienda de zona). Los errores no se cachean y
**si Redis falla, el servicio responde desde Postgres** (`src/common/cache/cache.service.ts`).

Convención de llaves: `<servicio>:<recurso>[:<parámetros>]` con un prefijo por servicio (`pricing:`,
`catalog:`; más `session:` y `revoked:` de autenticación). Ver las llaves en vivo:
`docker exec retail_redis redis-cli --scan --pattern 'pricing:*'`.

> `src/common/auth/redis.client.ts` (plantilla, no se modifica) lista los usos de Redis y solo nombra
> `catalog:*`; falta que Juan agregue `pricing:*` ahí.

## Levantarlo solo

Requiere Postgres con `db/schema.sql` aplicado y Redis (ver `infra/docker-compose.yml`).

```bash
npm install
cp .env.example .env     # PORT=3103, DB_* y REDIS_* de localhost
npm run start:dev
curl localhost:3103/v1/health
```

## Swagger

`http://localhost:3103/docs` (JSON crudo en `/docs-json`). Cada ruta lleva ejemplo de
respuesta en **JSON y XML** y sus errores estándar. El XML de ejemplo se genera desde el
ejemplo JSON con la misma lógica del `XmlInterceptor` (`src/common/swagger/ejemplos.ts`);
los datos de ejemplo viven en `src/common/swagger/muestras.ts`. La prueba
`test/swagger.spec.ts` falla si una ruta queda sin documentar.

Para probar rutas protegidas desde Swagger: **Authorize** con el `accessToken` de
`POST http://localhost:3101/v1/auth/login`.

## Docker

- **Desarrollo / demo** (lo usa `infra/docker-compose.yml`): imagen `node:20` con la carpeta
  montada y `npm run start:dev`. Necesita postgres y redis arriba; la primera vez tarda ~1 min.
  ```bash
  docker compose -f infra/docker-compose.yml up -d --no-deps pricing-service
  ```
  El `--watch` del contenedor **no detecta cambios** hechos desde Windows (montaje de Docker Desktop):
  tras editar código, `docker compose -f infra/docker-compose.yml restart pricing-service`.
- **Producción** (GCP, Parcial 3): el `Dockerfile` de esta carpeta, multi-etapa; arranca con
  `node dist/main.js`. El `.dockerignore` evita enviar `node_modules` al contexto de build.
  ```bash
  docker build -t pricing-service .
  docker run --network <red-de-compose> -p 3103:3103 -e PORT=3103 -e SERVICE_NAME=pricing-service \
    -e JWT_ACCESS_SECRET=... -e REDIS_HOST=redis -e DB_HOST=postgres -e DB_USER=... \
    -e DB_PASSWORD=... -e DB_NAME=retaildb pricing-service
  ```

## Pruebas

```bash
npm test                 # unitarias
npm run test:integracion # integración: requiere el servicio, Postgres y Redis arriba
# contra otro host/puerto (p. ej. la imagen de producción en el 3113):
PRICING_BASE_URL=http://localhost:3113 npm run test:integracion
```

La integración registra precios reales: escoge una pareja presentación+tienda **sin precios** en
el seed y borra lo que crea, así el historial del seed no se altera. Los usuarios que escriben
precios deben existir en `usuarios` (`precios.creado_por` es llave foránea).

También comprueba la bitácora, así que necesita `audit-service` arriba
(`docker compose -f infra/docker-compose.yml up -d --no-deps audit-service`). La bitácora es
append-only: cada corrida deja 3 eventos de `precios` que no se borran.

## Datos

Postgres compartido, `synchronize: false`, `db/schema.sql` es la fuente de verdad. Este
servicio solo escribe la tabla `precios`.
