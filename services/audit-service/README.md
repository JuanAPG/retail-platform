# audit-service — bitácora y consultas históricas (Sprint 2+3)

Dueño de `auditoria` y `auditoria_cambios` (Postgres compartido, solo
escribe sus tablas). Parte de la plantilla transversal: health, error
estándar, logging, XML y `SessionGuard` ya vienen resueltos.

## Endpoints (`/v1/`, JSON y XML)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/v1/auditoria` | ninguna (red privada) | Registra un evento → `201 {id}`. Sin guard a propósito: la auditoría nunca bloquea al reportero |
| `GET` | `/v1/auditoria` | SessionGuard, Administrador y Auditor | Bitácora paginada `{data,total,page,limit}` con filtros `tabla, registroId, usuarioId, accion, dateFrom, dateTo` |

Contrato con ejemplos: `docs/contratos/audit-service.md` + `audit-service.xsd`.
`Historial por entidad` = `GET /v1/auditoria?tabla=X&registroId=Y`.

## Correr y probar

```bash
npm install
PORT=3110 SERVICE_NAME=audit-service npm run start:dev
npm test                                   # unitarias (sin infra)
npm run test:integracion                   # requiere stack (VM)
```

Diferencias con M15: rutas bajo `/v1/`, `AuditFilterDto` extiende el
`PaginationDto` transversal, `POST` de eventos para llamadas entre
servicios (misma forma que espera el `AuditReporter` de auth-service) y
`bcryptjs` no aplica aquí (sin passwords en este servicio).
