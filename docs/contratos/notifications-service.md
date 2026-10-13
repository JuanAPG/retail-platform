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

| Evento | Puede originarlo | Le llega a | Copia a |
|---|---|---|---|
| `producto.propuesto` | Proveedor | rol Gerente de categoría (fijo) | — |
| `precio.propuesto` | Proveedor | rol Responsable de precios (fijo) | — |
| `propuesta.resuelta` | Gerente de categoría, Responsable de precios | el usuario que propuso | rol Auditor |
| `precio.umbral` | Responsable de precios | rol Responsable de precios (fijo) | rol Auditor (D-09) |
| `precio.observado` | Analista comercial, Responsable de precios | rol Responsable de precios (fijo) | — |
| `observacion.resuelta` | Responsable de precios | el usuario que la capturó | rol Auditor |
| `corrida.terminada` | Analista comercial, Responsable de precios | el usuario que lanzó la corrida | — |
| `escenario.generado` | Planeador (D-12) | el usuario que lo generó | — |
| `recomendacion.generada` | Planeador (D-12) | rol Gerente de categoría (fijo) | — |
| `recomendacion.resuelta` | Gerente de categoría | rol Planeador (fijo) | rol Auditor |
| `proveedor.solicitud` | **sin regla: nadie** | — | — |
| `proveedor.resuelto` | **sin regla: nadie** | — | — |

**Corregido 2026-10-13** (orígenes alineados con los `@Roles` reales de
main y decisiones del equipo):

- Se quita al Administrador de todos los orígenes: ningún endpoint emisor
  lo admite ya (catalog `APRUEBAN_PRODUCTOS` = Gerente; pricing `POST
  /v1/prices` = Responsable de precios por D1; algorithms-core Apriori y
  FP-Growth = Analista, elasticidad = Responsable de precios).
- D-12: el **Planeador** simula y genera recomendaciones; el **Gerente de
  categoría** las aprueba o rechaza. Por eso `recomendacion.generada` va
  a la bandeja del Gerente y `recomendacion.resuelta` vuelve al Planeador.
- **Copia automática al Auditor**: el emisor manda **un solo** aviso; el
  servicio guarda además una notificación por cada rol de «Copia a», con
  su propio dedup y su propio registro en auditoría. La respuesta del
  `POST` es siempre la notificación principal.

**Agregado 2026-10-09** (PRI-09/D-16, precios observados en tienda vía
app móvil): `precio.observado` se emite al capturar (`POST
/v1/price-observations`, roles `CAPTURAN_OBSERVACIONES` = Analista
comercial o Responsable de precios) y avisa a la bandeja del Responsable
de precios, que es quien resuelve. `observacion.resuelta` se emite al
aprobar o rechazar (`PATCH /v1/price-observations/:id/approve|reject`,
`APRUEBAN_PRECIOS` = únicamente Responsable de precios, mismo D1 de
arriba) y vuelve a quien la capturó (`recipientUserId`). Antes de este
cambio `PriceObservationsService` no inyectaba `NotificationsReporter`:
no emitía ninguno de los dos, y tampoco existían en este catálogo
cerrado.

**Agregado 2026-10-10, corregido 2026-10-11** (ALG-10): `corrida.terminada`
aplica a corridas de **asociación y de elasticidad**, no solo asociación.
Se emite al terminar una corrida de asociación (`POST
/v1/association/apriori/run` en algorithms-core — ojo, NO
`/v1/association/run`, `@Roles(Administrador, Analista comercial)`) y
vuelve a quien la lanzó (`recipientUserId`), mismo criterio que
`escenario.generado`. De ~40 corridas medidas, ninguna llegaba a
audit-service ni emitía notificación porque el evento no existía en este
catálogo cerrado — algorithms-core lo rechazaba o simplemente no lo
intentaba. `origenes` incluye también al **Responsable de precios**: una
corrida de elasticidad (precio-demanda) la lanza ese rol, no solo
Administrador/Analista — algorithms-core todavía no tiene módulo de
elasticidad, así que hoy esta regla solo se ejerce desde asociación, pero
el catálogo ya está listo para cuando exista. `analytics-stats`
(clustering, RF-16) aún no tiene endpoints propios, así que no entra en
`origenes` hasta que exista el `@Roles` real que lo respalde; cuando se
agregue, su origen se suma aquí, no se asume.

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

Request XML (`Content-Type: application/xml`, raíz `notificacionRequest`
del XSD, mismo `xmlns` `notif/v1`): equivale al JSON de arriba y pasa por
las mismas validaciones. XML mal formado, raíz distinta, `DOCTYPE`/`ENTITY`
o cuerpo mayor a 100 kb → **400** `VALIDATION_ERROR` (error estándar en
JSON o XML según `Accept`). Los demás endpoints no llevan cuerpo.

Response `201` (o `200` si fue dedup): la notificación con `id`,
`readBy: []`, `archived: false`, `createdAt`.

## Persistencia y errores

MongoDB, colección `notificaciones` (`MONGO_URL`). `id` es UUID v4
(`_id` del documento). Índices: `{recipientUserId, createdAt}`,
`{recipientRole, createdAt}`, el de dedup
`{eventType, relatedEntityId, recipientUserId, recipientRole, createdAt}`
y `{archived, createdAt}` para el job de archivado.

Si MongoDB se cae con el servicio en marcha: `GET /v1/health` responde
200 con `status: degraded` y `checks.mongodb` con el motivo, y las rutas
de `/v1/notifications` responden **503** `SERVICE_UNAVAILABLE` con el
error estándar (JSON o XML); al volver Mongo se recupera solo. Al
arrancar, el servicio espera a que Mongo responda (reintentos de
`@nestjs/mongoose`), igual que documents-service.

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

`eventType` es un `xs:enumeration` cerrado con los 12 eventos de la tabla
de permisos de arriba. Un `eventType` fuera de él responde `400`
(`VALIDATION_ERROR`), igual en JSON y en XML (raíz `error`).
