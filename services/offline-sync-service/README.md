# offline-sync-service (puerto 3118) · T-17

Recibe lotes de capturas hechas **sin conexión** (app móvil en JSON, escritorio en XML con
XSD), aplica la idempotencia por `captureId` y la regla de conflicto de **D-42**, y devuelve un
**acuse por captura**: `aceptada`, `duplicada`, `conflicto` o `rechazada`.

- Contrato (fuente de verdad): [`docs/contratos/offline-sync-service.md`](../../docs/contratos/offline-sync-service.md)
  y [`.xsd`](../../docs/contratos/offline-sync-service.xsd) (namespace `sync/v1`).
- Decisiones: D-42 (idempotencia y conflicto), D-47 (Mongo y Redis), D-28 / D-31 (roles),
  D-25 (almacén caído → 503), D-43 (retención de 1 año), D-26 (solo ids de usuario).
- Base: `services/template-nest/` (correlación, error estándar, health, XML, `SessionGuard`).

## ⚠️ Qué está SIMULADO

**Los destinos de las capturas están simulados.** El mapeo hacia availability-service
(3114), pricing-service (3103), visitas de campo y propuestas de producto quedó
**PENDIENTE de acuerdo con Pamela** (contrato §6). Por eso:

- Las capturas pasan por el puerto `DESTINO_CAPTURAS` (`src/sync/destinos/destino.ts`) y la
  única implementación es `DestinoSimulado` (en memoria). **No llega nada** a availability ni
  a pricing; lo que el simulado "acepta" se pierde al reiniciar el proceso. Lo que este
  servicio guarda (lotes, capturas, acuses) sí queda en Mongo.
- El simulado imita lo que ya dicen los contratos de destino, sin inventar reglas:
  `disponibilidad` gana el dato capturado después (conflicto si el destino tiene uno igual o
  posterior; id de destino = `captureId`, como availability); `precio_observado` siempre se
  registra con un id nuevo (como pricing hoy, D-16) y **no** decide conflictos.
- Cuando se acuerde el mapeo, se agrega un adaptador HTTP que cumpla el puerto: idempotente por
  `captureId`, con `Authorization` + `X-Correlation-Id` y timeout de 3 s.
- Tipos `visita_campo` y `propuesta_producto`: **no implementados** (no están en el XSD 1.0).

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
   (`sync:ultimo:{tipo}:{tienda}:{presentación}`) → destino (simulado).
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

La integración crea sus propios contenedores (`offline-sync-it-mongo` en 27118,
`offline-sync-it-redis` en 6418, base `offline_sync_it`), los **pausa** para probar el 503 y los
borra al final; no toca los de `infra/docker-compose.yml`. Necesita Docker y Python con `lxml`
(valida el XML contra el XSD con un validador independiente del servicio). Con
`SYNC_IT_DOCKER=0` usa los `MONGO_URL` / `REDIS_*` del entorno y omite las pruebas de caída.

## Archivos que viajan con el servicio

`src/contrato/offline-sync-service.xsd` es una **copia** del XSD del contrato (la imagen solo
lleva esta carpeta). Una prueba unitaria falla si se desfasa de `docs/contratos/`.
