# Contrato: notifications-service (Fase A)

Base: `http://notifications-service:3109` · Rutas `/v1/`, JSON por defecto
y XML si `Accept: application/xml` (XSD en `notifications-service.xsd`).

> Identidad del JWT manda: `recipientUserId` y rol siempre salen del token
> (`SessionGuard`), nunca de parámetros abiertos. `?userId` existe solo
> como filtro opcional para Administrador y Auditor.

## POST /v1/notifications (SessionGuard + tabla de permisos)

La usa otro microservicio para emitir un evento. Si ESTE servicio no
responde, quien lo llamó no debe fallar su operación (fire-and-forget con
timeout corto del lado emisor).

**El emisor no decide ni quién emite ni a quién le llega.** El servicio
emisor reenvía el `Authorization` del usuario que originó la acción, y con
ese rol se valida contra la tabla de `notification.types.ts`:

| Evento | Puede originarlo | Le llega a |
|---|---|---|
| `producto.propuesto` | Proveedor | rol Gerente de categoría (fijo) |
| `precio.propuesto` | Proveedor | rol Gerente de categoría (fijo) |
| `propuesta.resuelta` | Administrador, Gerente de categoría | el usuario que propuso |
| `precio.umbral` | Administrador, Responsable de precios | rol Responsable de precios (fijo) |
| `escenario.generado` | Administrador, Analista comercial | el usuario que lo generó |
| `recomendacion.generada` | Administrador, Analista comercial | rol Planeador (fijo) |
| `recomendacion.resuelta` | Gerente de categoría | rol Analista comercial (fijo) |
| `proveedor.solicitud` | **sin regla: nadie** | — |
| `proveedor.resuelto` | **sin regla: nadie** | — |

Destinos fijados por el equipo el 2026-10-08 (antes estaban "pendiente":
el origen ya se validaba, pero el emisor todavía elegía el destinatario).

- Rol fuera de la lista → **403**.
- Evento con destino FIJO al que se le manda otro `recipientRole` o un
  `recipientUserId` → **400** (no se ignora en silencio: un emisor que
  cree estar avisando a alguien más tiene un bug).
- Evento con destino de usuario sin `recipientUserId` → **400**.
- Los dos eventos «sin regla» no tienen flujo implementado en ningún
  servicio, así que hoy no se pueden emitir (403). En cuanto exista el
  endpoint que los dispare, su `@Roles` da el origen y se agregan aquí.

`sourceService` es **obligatorio** y de lista cerrada: `catalog-service`,
`pricing-service`, `core-process-service`, `algorithms-core`,
`analytics-stats`, `decision-service`, `documents-service`,
`audit-service`. Antes se aceptaba sin él y quedaba siempre `null`, así
que no había forma de saber de dónde venía una notificación.

Request JSON:

```json
{
  "eventType": "producto.propuesto",
  "sourceService": "catalog-service",
  "relatedEntityType": "producto",
  "relatedEntityId": "uuid-producto",
  "title": "Nueva propuesta de producto",
  "message": "BioOrgánicos propuso Quinoa 500 g.",
  "priority": "info"
}
```

No lleva destinatario: `producto.propuesto` va siempre al rol Gerente de
categoría y lo pone el servicio.

`priority` solo admite `info | warning | critical`. Si ya existe una no
archivada con mismo `eventType` + `relatedEntityId` + **destinatario**
(`recipientUserId` o `recipientRole`) creada en los últimos 5 minutos, NO
se duplica: responde `200` con la existente. Distinto destinatario siempre
crea una nueva (201), aunque coincidan evento y entidad.

Response `201` (o `200` si fue dedup): la notificación con `id`,
`readBy: []`, `archived: false`, `createdAt`.

## GET /v1/notifications (SessionGuard)

Solo las del solicitante: `recipientUserId = JWT.id` **OR**
`recipientRole = JWT.rol`, excluyendo `archived`. Filtros opcionales:
`?userId=` (solo Admin/Auditor, para ver las de otro), `?archived=`,
más `page`/`limit` del estándar. Response `{data,total,page,limit}`.

## GET /v1/notifications/:id (SessionGuard)

Una notificación **dirigida al solicitante**: `recipientUserId` igual a su
id, o `recipientRole` igual a su rol. Cualquier otra cosa es **404**, no
403: un 403 confirmaría que esa notificación existe. El cuerpo del 404 es
idéntico al de una inexistente.

## PATCH /v1/notifications/:id/read (SessionGuard)

Marca como leída **para el usuario del token**: upsert en `readBy`
(`{userId, readAt}`). Nunca es un flag global. Response `200` con la
notificación. Sin JWT no hay a quién marcarle: 401.

Sujeta a la **misma regla de destinatario** que `GET /:id`: si no va
dirigida al usuario, **404** y no se devuelve nada del contenido. Antes no
se comprobaba, así que un Proveedor podía marcar como leída la
notificación de un Gerente y la respuesta le devolvía el mensaje
completo.

## GET /v1/notifications/unread-count (SessionGuard)

`{ "unread": 3 }`: no archivadas del solicitante (mismo criterio del
listado) sin entrada propia en `readBy`. Agregación del lado servidor.

## XML (XSD: `notifications-service.xsd`)

Raíz por endpoint, declarada con `@XmlRoot` en el controller:

| Endpoint | Raíz XML |
|---|---|
| `POST /v1/notifications` | `notificationResponse` |
| `PATCH /v1/notifications/:id/read` | `notificationResponse` |
| `GET /v1/notifications/:id` | `notificationDetailResponse` |
| `GET /v1/notifications` | `notificationListResponse` |
| `GET /v1/notifications/unread-count` | `unreadCountResponse` |

`eventType` es un `xs:enumeration` cerrado con los 9 eventos de la tabla de
permisos de arriba — el mismo catálogo, no uno nuevo. Un `eventType` fuera
de él responde `400` (`VALIDATION_ERROR`), igual en JSON y en XML (raíz
`error`).
