# offline-sync-service (puerto 3118) · T-17

Recibe lotes de capturas hechas **sin conexión** (app móvil en JSON, escritorio en XML con
XSD), aplica la idempotencia por `captureId` y la regla de conflicto de **D-42**, y devuelve un
**acuse por captura**: `aceptada`, `duplicada`, `conflicto` o `rechazada`.

- Contrato (fuente de verdad): [`docs/contratos/offline-sync-service.md`](../../docs/contratos/offline-sync-service.md)
  y [`.xsd`](../../docs/contratos/offline-sync-service.xsd) (namespace `sync/v1`).
- Decisiones: D-42 (idempotencia y conflicto), D-47 (Mongo y Redis), D-28 / D-31 (roles),
  D-25 (almacén caído → 503), D-43 (retención de 1 año), D-26 (solo ids de usuario).
- Base: `services/template-nest/` (correlación, error estándar, health, XML, `SessionGuard`).

## Destinos de las capturas (`SYNC_DESTINO`)

| `SYNC_DESTINO` | Qué pasa con cada captura |
|---|---|
| `http` (por defecto, Dockerfile y `.env.example`) | `DestinoHttp`: `disponibilidad` → availability-service (`POST /v1/availability/captures`), `precio_observado` → pricing-service (`POST /v1/price-observations`). La tabla de cada código HTTP → estado del acuse está en el contrato §6. |
| `simulado` | `DestinoSimulado` en memoria: **no sale nada**. Lo usan las pruebas unitarias y la integración general; sirve para una demo sin destinos. |

- Con `http` hacen falta `AVAILABILITY_SERVICE_URL` y `PRICING_SERVICE_URL`. Si falta alguna,
  **el servicio no arranca** y el error dice cuál.
- Cada llamada reenvía el `Authorization` del usuario y el `X-Correlation-Id` del lote, con
  timeout de 3 s. Destino caído, timeout, error de red o `5xx` → la captura queda `rechazada`
  con `retryable: true` y el siguiente envío la reprocesa. Es seguro: los dos destinos son
  idempotentes por el id del dispositivo (`captureId` / `observationId = captureId`).
- `GET /v1/health` en JSON trae `destinos: { modo, availability, pricing }`. En XML no va,
  porque `health.xsd` (compartido) no lo admite.
- Tipos `visita_campo` y `propuesta_producto`: **no implementados** (no están en el XSD 1.0).

### Correr en modo http

1. Levanta los destinos y aplica sus migraciones si tu base es anterior a ellas:

   ```bash
   docker compose -f infra/docker-compose.yml up -d postgres redis mongodb auth-service availability-service pricing-service
   docker exec -i retail_postgres psql -U retail_user -d retaildb < db/migraciones/sprint4_availability.sql
   docker exec -i retail_postgres psql -U retail_user -d retaildb < db/migraciones/sprint4_pricing_observaciones.sql
   ```

   | Destino | Migración | Sin ella |
   |---|---|---|
   | availability-service | `sprint4_availability.sql` (tabla `disponibilidad_capturas`) | availability responde 500 → la captura queda reintentable |
   | pricing-service | `sprint4_pricing_observaciones.sql` (columna `precios_observados.observacion_id`) | pricing responde 500 → la captura queda reintentable |

   Las dos son idempotentes (se pueden correr varias veces). Un volumen nuevo ya las trae en
   `db/schema.sql`.

2. Fuera de Docker, apunta a los puertos publicados:

   ```bash
   SYNC_DESTINO=http AVAILABILITY_SERVICE_URL=http://localhost:3114 PRICING_SERVICE_URL=http://localhost:3103 npm run start:prod
   curl -s localhost:3118/v1/health   # "destinos": { "modo": "http", "availability": "ok", "pricing": "ok" }
   ```

   Dentro del compose: `http://availability-service:3114` y `http://pricing-service:3103`.

Tampoco se envía hoy con éxito la auditoría ni el aviso: audit-service y
notifications-service tienen listas cerradas que todavía no incluyen `offline-sync-service`
ni el evento `sync.conflicto` (los agrega Juan Ángel en T-19/T-20). Mientras, responden 400 y
el lote queda con `delivery.audit` / `delivery.notification = fallido` y un `WARN aviso_fallido`
en el log; la sincronización no se afecta.

## Rutas

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/sync/batches` | Investigador de mercado, Analista comercial, Responsable de precios. Por tipo: `disponibilidad` → Investigador y Analista; `precio_observado` → los tres |
| GET | `/v1/sync/batches` | Admin y Auditor (todos); los otros tres, solo los suyos |
| GET | `/v1/sync/batches/:batchId` | Igual; un lote ajeno → 404 |
| GET | `/v1/health` | Sin autenticación (`health.xsd`) |

Swagger con ejemplos JSON y XML en `/docs` (`/docs-json`).

## Cómo funciona un lote

1. `CuerpoLoteMiddleware`: JSON o XML (≤ 1 MB, ≤ 500 capturas → si no, 413). El XML se valida
   contra el XSD **en el servidor** con libxml2 compilado a WebAssembly (`xmllint-wasm`) y se
   convierte al mismo objeto que el JSON.
2. DTO (estructura del lote → 400 del lote completo).
3. Candado del lote en Redis (`sync:lock:{batchId}`, `SET NX`, 60 s): un envío simultáneo → 409.
4. Lote en Mongo (`lotes_sync`, `_id = batchId`). Mismo `batchId` con otro contenido → 409;
   con el mismo, es un reenvío (`resend: true`).
5. Por captura: idempotencia (`sync:captura:{id}` en Redis, `capturas_sync` en Mongo) →
   reglas y permiso por tipo → conflicto dentro del lote → último estado aceptado
   (`sync:ultimo:{tipo}:{tienda}:{presentación}`) → destino (HTTP o simulado, según `SYNC_DESTINO`).
6. **Escritura adelantada:** cada captura queda `procesando` en Mongo antes de ir al destino.
   Si el proceso se cae a medio lote, el siguiente envío la reprocesa y el destino (idempotente)
   no la repite.
7. Acuse en Mongo; auditoría y aviso después, sin esperarlos.

Mongo o Redis caídos → 503 antes de enviar cualquier captura.

## Correr

```bash
npm install
cp .env.example .env              # ajusta MONGO_URL / REDIS_* / JWT_ACCESS_SECRET
npm run build && npm run start:prod
curl -i localhost:3118/v1/health  # trae X-Correlation-Id
```

## Pruebas

```bash
npm test                  # unitarias (adaptadores en memoria, sin Docker)
npm run test:integracion  # integración: levanta Mongo y Redis AISLADOS en Docker
```

`test:integracion` corre dos archivos:

- `sync.integracion.spec.ts`: el flujo completo con el destino **simulado** (sus ganchos de
  prueba).
- `destinos-reales.integracion.spec.ts`: modo `http` contra availability-service (3114) y
  pricing-service (3103) **reales** del stack local, con sesiones reales de auth-service
  (3101). Necesita esos servicios arriba y las dos migraciones de arriba; si falta algo, la
  prueba **falla** diciendo qué falta. Escribe en la base local (capturas de existencia y
  observaciones pendientes). Entre sync y cada destino pone un proxy de prueba que registra
  los encabezados y se puede "apagar" para el caso del destino caído.

La integración crea sus propios contenedores (`offline-sync-it-mongo` en 27118,
`offline-sync-it-redis` en 6418, base `offline_sync_it`), los **pausa** para probar el 503 y los
borra al final; no toca los de `infra/docker-compose.yml`. Necesita Docker y Python con `lxml`
(valida el XML contra el XSD con un validador independiente del servicio). Con
`SYNC_IT_DOCKER=0` usa los `MONGO_URL` / `REDIS_*` del entorno y omite las pruebas de caída.

## Archivos que viajan con el servicio

`src/contrato/offline-sync-service.xsd` es una **copia** del XSD del contrato (la imagen solo
lleva esta carpeta). Una prueba unitaria falla si se desfasa de `docs/contratos/`.
