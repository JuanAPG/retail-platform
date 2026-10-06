# core-process-service — proceso principal + M09 (Sprint 2+3)

Proceso principal (M06 transacciones + importación CSV, M07 canastas) más
M09 analítica descriptiva sobre esos mismos datos. Parte de la plantilla
transversal.

## Endpoints (`/v1/`, JSON y XML, SessionGuard)

- M06: `POST /v1/transactions` (manual), `POST /v1/transactions/import/preview|confirm`,
  `GET /v1/transactions/import/pending`, `GET /v1/transactions[?filtros]`, `GET /v1/transactions/:id`.
  Escritura Admin/Analista. Valida contra catalog-service por HTTP (caído → 503, sin insertar);
  reporta a audit-service best-effort.
- M07: `GET /v1/baskets[?filtros]`, `GET /v1/baskets/:id`. 1:1 con transacción, zona y segmento
  congelados; segmento por lectura de `zona_clasificaciones` (RN-02).
- M09: `average-ticket`, `products-per-basket`, `purchase-frequency`,
  `units-per-transaction`, `spend-by-category` con filtros.

Contratos: `docs/contratos/core-process-transactions.md`,
`docs/contratos/core-process-analytics.md` (+ XSD).

## Correr y probar

```bash
npm install
PORT=3104 SERVICE_NAME=core-process-service npm run start:dev
npm test                                   # unitarias (sin infra)
npm run test:integracion                   # requiere stack con seed + CSV (VM)
```

Base de los 9 microservicios NestJS. Ya resuelve lo transversal — **no se
modifica por servicio**, solo se agregan módulos de negocio.

## Qué trae resuelto

- `GET /v1/health` sin auth (`src/health/`)
- Error estándar `{ statusCode, message, code, details, path, timestamp }`
  (`src/common/filters/`, catálogo en `services/snippets/error-codes.md`)
- Logging JSON por operación (`src/common/interceptors/logging.interceptor.ts`)
- XML si `Accept: application/xml` (`xml.interceptor.ts`; XSD en `docs/contratos/`)
- `SessionGuard`: JWT + `revoked:{jti}` + `session:{userId}` en Redis
  (`src/common/auth/`). Aplicar con `@UseGuards(SessionGuard)`.
