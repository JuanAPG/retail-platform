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
| Auditoría del alta de precios | pendiente (`TODO(audit)` en el servicio) |
| Caché de precios en Redis | pendiente |
| Propuestas de precio del Proveedor (`precios_propuestos_proveedor`) | fuera de alcance por ahora |

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

## Datos

Postgres compartido, `synchronize: false`, `db/schema.sql` es la fuente de verdad. Este
servicio solo escribe la tabla `precios`.
