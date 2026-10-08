# documents-service (M16) — Reportes ejecutivos, PDF e historial en MongoDB

Contrato: [docs/contratos/documents-service.md](../../docs/contratos/documents-service.md) · XSD:
[documents-service.xsd](../../docs/contratos/documents-service.xsd) (namespace `documents/v1`).

## Qué hace

- `POST /v1/reports/executive` (Gerente de categoría): arma el reporte con los **16 indicadores** de la
  retroalimentación, consultando por HTTP a core-process, catalog, algorithms-core, pricing y decision,
  y lo guarda en MongoDB. Si un servicio no responde (3 s), su indicador sale `disponible: false`
  con el motivo, **nunca como 0**.
- `GET /v1/reports`, `GET /v1/reports/:id`, `PATCH /v1/reports/:id`, `GET /v1/reports/stats/by-user-month`.
- `GET /v1/reports/:id/export?format=pdf`: PDF generado del documento guardado (acentos, ñ, `$` y `%`).
  Excel queda para después (D-19).
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
- Pendiente: exportación a Excel (`xlsx`) y avisos a notifications-service.
