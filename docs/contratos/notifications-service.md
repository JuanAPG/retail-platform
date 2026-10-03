# Contrato: notifications-service (Fase A)

Base: `http://notifications-service:3109` · Rutas `/v1/`, JSON por defecto
y XML si `Accept: application/xml` (XSD en `notifications-service.xsd`).

> Identidad del JWT manda: `recipientUserId` y rol siempre salen del token
> (`SessionGuard`), nunca de parámetros abiertos. `?userId` existe solo
> como filtro opcional para Administrador y Auditor.

## POST /v1/notifications (SessionGuard, cualquier autenticado)

La usa otro microservicio (o un operador) para emitir un evento. Si el
emisor no responde... al revés: si ESTE servicio no responde, quien lo
llamó no debe fallar su operación (fire-and-forget con timeout corto
del lado emisor).

Request JSON:

```json
{
  "eventType": "precio.propuesto",
  "relatedEntityType": "presentacion",
  "relatedEntityId": "uuid-presentacion",
  "recipientUserId": "uuid-proveedor",
  "recipientRole": null,
  "title": "Nuevo precio propuesto",
  "message": "Presentación 500 g propuesta a $24.00 por BioOrgánicos.",
  "priority": "info"
}
```

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

## PATCH /v1/notifications/:id/read (SessionGuard)

Marca como leída **para el usuario del token**: upsert en `readBy`
(`{userId, readAt}`). Nunca es un flag global. Response `200` con la
notificación. Sin JWT no hay a quién marcarle: 401.

## GET /v1/notifications/unread-count (SessionGuard)

`{ "unread": 3 }`: no archivadas del solicitante (mismo criterio del
listado) sin entrada propia en `readBy`. Agregación del lado servidor.
