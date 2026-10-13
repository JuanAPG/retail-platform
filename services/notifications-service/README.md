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

## Persistencia

MongoDB (`MONGO_URL`), colección `notificaciones`, vía
`MongoNotificationsRepository` tras el puerto `NOTIFICATIONS_REPOSITORY`.
`InMemoryNotificationsRepository` queda solo para las unitarias. Con
Mongo caído en marcha: health `degraded` y 503 en las rutas. El job diario archiva
a 90 días y jamás elimina.

## Correr y probar

```bash
npm install
PORT=3109 SERVICE_NAME=notifications-service npm run start:dev
npm test                                   # unitarias (sin infra)
npm run test:integracion                   # requiere mongodb + redis + auth-service con seed
```
