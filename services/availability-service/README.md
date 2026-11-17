# availability-service (3114)

Existencias por tienda y presentación, cobertura de la canasta básica y faltantes
(T-11, Sprint 4). Responsable: Pamela Rodríguez. Parte de `services/template-nest/` (T-02).

- Contrato: [`docs/contratos/availability-service.md`](../../docs/contratos/availability-service.md)
  y su XSD (namespace `availability/v1`).
- Decisiones: **D-38** (la disponibilidad pasa a este servicio; faltante, vigencia de 7
  días y cobertura), **D-03** (canasta básica), **D-28** (el Investigador de mercado
  captura) y **D-42** (una captura más vieja no sobrescribe).
- Permisos (Matriz §3.2): capturan el **Investigador de mercado** y el **Analista
  comercial**; leen los 6 perfiles internos; el Proveedor → 403.

## Qué hace

| Ruta | Para qué |
|---|---|
| `POST /v1/availability/captures` | Registra una existencia. Responde `aceptada`, `conflicto` o `duplicada` |
| `GET /v1/availability/captures` | Bitácora de capturas |
| `GET /v1/availability/stock` | Existencia actual: `disponible`, `agotado` o `vencido` (más de 7 días) |
| `GET /v1/availability/stores/:storeId/coverage` | % de básicos con existencia vigente en la tienda |
| `GET /v1/availability/zones/:zoneId/coverage` | Lo mismo por zona, con % de tiendas que tienen cada básico |
| `GET /v1/availability/shortages?storeId=` o `?zoneId=` | Faltantes |
| `GET /v1/health` | Salud con Postgres y Redis (sin sesión) |

Reglas (detalle y casos de control en el contrato):

- Un dato vale **7 días** (`AVAILABILITY_VALID_DAYS`). Vencido no cuenta ni como que hay
  ni como que falta.
- Un básico está **cubierto** si **alguna** de sus presentaciones tiene existencia vigente.
  Otro producto no lo cubre.
- **Faltante**: ninguna presentación cubre y hay al menos un dato vigente (todo en 0).
- Sin datos vigentes la cobertura sale `disponible: false` con motivo y **sin número**.
- Gana el dato que se **capturó** más tarde, no el que se subió más tarde (D-42).

## Datos

Postgres compartido. Este servicio es el único que escribe:

- `inventario`: existencia actual; `actualizado_en` es cuándo se vio el dato.
- `disponibilidad_capturas` (nueva): bitácora que solo se anexa; `captura_id` único da la
  idempotencia.

No usa MongoDB. Redis solo para la sesión.

Una base creada **antes** de este servicio se actualiza sin perder datos con:

```bash
docker exec -i retail_postgres psql -U retail_user -d retaildb \
  < db/migraciones/sprint4_availability.sql
```

## Otros servicios (por HTTP, con el token y el `X-Correlation-Id` de quien llama)

| Servicio | Para qué | Si no responde en 3 s |
|---|---|---|
| catalog-service | Canasta básica (`/v1/products`), tiendas y zonas | `503` en cobertura y faltantes |
| audit-service | Bitácora de cada captura | Se ignora: la captura se completa |

Capturar no depende de ningún otro servicio: la tienda y la presentación las valida la
llave foránea.

## Levantarlo

```bash
docker compose -f infra/docker-compose.yml up -d availability-service
curl -i localhost:3114/v1/health        # trae X-Correlation-Id
```

Swagger: <http://localhost:3114/docs> (ejemplos JSON y XML). Variables en `.env.example`.

## Pruebas

```bash
npm test                 # unitarias: vigencia, estados y los casos de control de cobertura
npm run test:integracion # contra el stack real; valida el XML contra el XSD
```

Las de integración necesitan `postgres redis catalog-service availability-service` arriba
con el seed, y Python con `lxml` para validar el XSD (sin él, esa validación se salta con
un aviso). Crean una zona, una tienda y tres básicos de prueba por la API de catalog, y
borran lo que crean. Si el seed no tiene al Investigador de mercado
(`investigador@retail.mx`), sus casos se saltan: recarga `db/data_retail.sql`.

## Pendientes y avisos

- **audit-service todavía rechaza a este servicio:** su catálogo de `servicio` solo admite
  los 10 del Parcial 2, así que responde `400` y las capturas no quedan en la bitácora.
  Aquí no rompe nada (el reporte no bloquea); falta agregar el nombre en audit-service
  (Juan Angel).
- **decision-service** sigue leyendo `inventario` por SQL para la accesibilidad. Debe pasar
  a `GET /v1/availability/zones/:zoneId/coverage` (Fernando).
- **offline-sync-service** (T-17) puede reenviar cada captura a
  `POST /v1/availability/captures` con su `captureId` y usar `status` como acuse.
- **Por confirmar con el Product Owner** (lista en el contrato): quién corrige existencias,
  registrar como decisión los casos de control de cobertura, y si la captura de campo
  necesita un "hay / no hay" sin cantidad.
- **Rendimiento:** la cobertura pide a catalog todos los productos y filtra los básicos.
  Con el catálogo del seed es inmediato; con el dataset grande del Parcial 3 conviene un
  filtro `esCanastaBasica` en catalog.
