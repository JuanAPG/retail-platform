# documents-service (M16) — Reportes ejecutivos, PDF e historial en MongoDB

Contrato: [docs/contratos/documents-service.md](../../docs/contratos/documents-service.md) · XSD:
[documents-service.xsd](../../docs/contratos/documents-service.xsd) (namespace `documents/v1`).

## Qué hace

- `POST /v1/reports/executive` (Gerente de categoría): arma el reporte con los **16 indicadores** de la
  retroalimentación, consultando por HTTP a core-process, catalog, algorithms-core, pricing y decision,
  y lo guarda en MongoDB. Si un servicio no responde (3 s), su indicador sale `disponible: false`
  con el motivo, **nunca como 0**.
- `GET /v1/reports`, `GET /v1/reports/:id`, `PATCH /v1/reports/:id`, `GET /v1/reports/stats/by-user-month`.
- `GET /v1/reports/:id/export?format=pdf|xlsx`: PDF (acentos, ñ, `$` y `%`) o Excel con las cifras como celdas
  numéricas, generados del documento guardado.
- El Proveedor solo ve sus propios reportes (`404` con los de otro).

## MongoDB

Colección `reportes` con índices `{usuarioId: 1, creadoEn: -1}` y `{tipo: 1, creadoEn: -1}`.
Con Mongo caído las rutas de reportes responden `503` y `GET /v1/health` sale `degraded`.

## Levantarlo

```bash
docker compose -f infra/docker-compose.yml up -d mongodb redis documents-service
curl localhost:3108/v1/health      # {"status":"ok", ... "checks":{"redis":"ok","mongodb":"ok"}}
```

Swagger en `http://localhost:3108/docs` (ejemplos JSON y XML con la raíz y namespace reales).
`mongo-express` (opcional): `http://localhost:8081` (admin / admin_pass_2026).

## Pruebas

```bash
npm test                    # unitarias (indicadores con fetch simulado, servicio con modelo simulado, PDF)
npm run test:integracion    # contra el servicio y MongoDB reales (requiere el stack arriba)
```

Las de integración generan reportes reales, comprueban que las cifras coinciden con su servicio de
origen, leen el PDF con un parser, verifican los índices con `explain()` (IXSCAN) y el aislamiento del
Proveedor. Con core-process, algorithms-core y decision apagados, el reporte sale con esos indicadores
como no disponibles: es el comportamiento esperado.

## Notas

- `UV_THREADPOOL_SIZE` se sube en `main.ts`: el DNS de un servicio apagado tarda ~2.5 s y con el pool
  por defecto (4 hilos) bloquea las consultas a los servicios sanos.
- Variables opcionales: `CORE_PROCESS_SERVICE_URL`, `CATALOG_SERVICE_URL`, `PRICING_SERVICE_URL`,
  `ALGORITHMS_CORE_URL`, `DECISION_SERVICE_URL`, `AUDIT_SERVICE_URL` (por defecto, el nombre del servicio en Docker).

## Sprint 4 · T-23: exportar a CSV

`GET /v1/reports/:id/export?format=csv` descarga los **16 indicadores** (una fila por indicador; los no disponibles con
su motivo y el valor vacío, nunca 0), en UTF-8 con BOM. Cada descarga, en cualquier formato, queda en la bitácora
con quién, cuándo y qué formato (D-46). Pruebas: `src/reports/csv.spec.ts` y `test/reports.spec.ts`.

## Parcial 3: archivo privado en GCS y descarga firmada

Flujo: Gerente → reporte de 16 indicadores → `POST /v1/reports/:id/files {format}` → objeto privado en
el almacén con registro (`archivos`: id, bucket/ruta, tipo, tamaño, dueño, fecha, SHA-256, estado) →
`POST /v1/reports/:id/files/:fileId/download-url` → URL firmada de 5 min → descarga. Contrato:
[docs/contratos/registro-archivos.md](../../docs/contratos/registro-archivos.md).

- `ARCHIVOS_ALMACEN=local` (default) usa un doble en disco con firma HMAC servida en
  `/v1/files/local/:id`; `ARCHIVOS_ALMACEN=gcs` + `GCS_BUCKET_REPORTES` usa GCS (`@google-cloud/storage` 7.x,
  firma V4, identidad del servicio). Con `gcs` sin bucket el servicio no arranca.
- El registro solo dice `disponible` después de verificar el objeto en el almacén. Almacén caído →
  `503`, archivo `fallido`, y la misma petición lo reintenta. Repetirla no sube otro objeto ni repite el aviso.
- La URL firmada no se guarda ni se loguea (los logs enmascaran `sig`/`X-Goog-*`). La bitácora distingue
  "URL emitida" (audit-service) de "objeto leído" (Cloud Audit Logs de GCS; `lecturas` en el doble local).
- `GET /v1/health` agrega `checks.almacen` y `almacen: { tipo, bucket }` (consulta el bucket cada 30 s).
- `X-Correlation-Id` (T-02) en logs, errores, auditoría, notificaciones y en el registro del archivo.
- `REDIS_PASSWORD` / `REDIS_TLS=true` opcionales para Memorystore en GCP (local sigue sin auth).

Pruebas: `src/reports/archivos/almacen/almacen.spec.ts` (adaptadores, firma, TTL, enmascarado) y
`test/archivos.spec.ts` (en proceso con MongoDB y Redis reales: dueño, ajeno 404, rol 403, concurrencia,
almacén caído y recuperación, objeto borrado, aviso único, hash de la descarga, firma alterada y vencida,
XML contra el XSD). `npm run test:integracion -- archivos` solo necesita `mongodb` y `redis` arriba.

### Manifiesto para staging (para Juan Ángel)

| Campo | Valor |
|---|---|
| Puerto interno | `3108` (`PORT`) |
| Imagen | `services/documents-service/Dockerfile` (multi-stage, `node dist/main.js`) |
| Obligatorias | `PORT`, `SERVICE_NAME=documents-service`, `XML_NAMESPACE=documents/v1`, `MONGO_URL`, `JWT_ACCESS_SECRET`, `REDIS_HOST`, `REDIS_PORT`, `ARCHIVOS_ALMACEN=gcs`, `GCS_BUCKET_REPORTES` |
| Opcionales | `REDIS_PASSWORD`, `REDIS_TLS`, `ARCHIVOS_URL_TTL_SEGUNDOS` (300), `GCS_TIMEOUT_MS`, `GCS_PROJECT_ID`, `AUDIT_SERVICE_URL`, `NOTIFICATIONS_SERVICE_URL`, `CORE_PROCESS_SERVICE_URL`, `CATALOG_SERVICE_URL`, `PRICING_SERVICE_URL`, `ALGORITHMS_CORE_URL`, `DECISION_SERVICE_URL` |
| Secretos (por nombre) | `JWT_ACCESS_SECRET`, `MONGO_URL` (lleva credenciales), `REDIS_PASSWORD`. GCS **sin llave**: identidad del servicio |
| Migraciones | Ninguna en Postgres. Mongo: colecciones `reportes` y `archivos`; los índices los crea el servicio al arrancar |
| Dependencias | MongoDB, Redis, bucket GCS; por HTTP: core-process, catalog, pricing, algorithms-core, decision, audit, notifications |
| Salud | `GET /v1/health` (siempre 200; `status: degraded` si Redis, Mongo o el bucket fallan) |
| Prueba | `npm ci && npm run build && npm test && npm run test:integracion` |

Falta en `infra/docker-compose.yml` (lo integra Juan Ángel): `NOTIFICATIONS_SERVICE_URL: http://notifications-service:3109`
en documents-service (hoy no está y los avisos no salen).
