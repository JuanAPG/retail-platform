# notifications-service — notificaciones internas (Sprint 2+3)

Emite, lista, marca como leídas y cuenta notificaciones por usuario o rol.
Parte de la plantilla transversal (health, error estándar, logging, XML,
`SessionGuard`).

## Endpoints (`/v1/`, JSON y XML, SessionGuard)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/v1/notifications` | Emite (dedup 5 min: responde la existente) |
| `GET` | `/v1/notifications` | Solo las del token (id o rol); `?userId` solo Admin/Auditor |
| `PATCH` | `/v1/notifications/:id/read` | Lectura por usuario en `readBy`, nunca global |
| `GET` | `/v1/notifications/unread-count` | `{unread}` por agregación |

Contrato: `docs/contratos/notifications-service.md` + `.xsd`. Matriz de
eventos (`priority/title/entidad` por tipo) en
`src/notifications/notification.types.ts`.

## Estado Mongo (pendiente explícito)

Sin Mongo todavía: persiste en `InMemoryNotificationsRepository` tras el
puerto `NOTIFICATIONS_REPOSITORY`. Cuando `documents-service` fije el
patrón: agregar `mongoose/@nestjs/mongoose`, `MONGO_URL` al compose,
adaptador Mongoose con sus índices y cablearlo en `app.module` — el
servicio y el controller no cambian. El job diario archiva a 90 días y
jamás elimina.

## Correr y probar

```bash
npm install
PORT=3109 SERVICE_NAME=notifications-service npm run start:dev
npm test                                   # unitarias (sin infra)
npm run test:integracion                   # requiere Mongo + stack (VM, skip hasta entonces)
```
