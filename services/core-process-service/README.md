# core-process-service — proceso principal + M09 (Sprint 2+3)

Proceso principal (transacciones + canastas) más M09 analítica descriptiva,
que agrega sobre esos mismos datos. Parte de la plantilla transversal.

## Endpoints M09 (`/v1/analytics`, JSON y XML, SessionGuard)

`average-ticket`, `products-per-basket`, `purchase-frequency`,
`units-per-transaction`, `spend-by-category` — con filtros `storeId`,
`zoneId`, `segmentId`, `dateFrom`, `dateTo`. Contrato:
`docs/contratos/core-process-analytics.md`.

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
