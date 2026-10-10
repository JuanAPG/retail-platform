# audit-service — bitácora y consultas históricas (Sprint 2+3)

Dueño de `auditoria` y `auditoria_cambios` (Postgres compartido, solo
escribe sus tablas). Parte de la plantilla transversal: health, error
estándar, logging, XML y `SessionGuard` ya vienen resueltos.

## Endpoints (`/v1/`, JSON y XML)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/v1/auditoria` | SessionGuard (cualquier perfil autenticado) | Registra un evento → `201 {id}`. Sin restricción de rol a propósito: un Proveedor debe poder dejar rastro de sus acciones. `usuarioId`/`rolId` salen del token, nunca del cuerpo |
| `GET` | `/v1/auditoria` | SessionGuard, Administrador y Auditor | Bitácora paginada `{data,total,page,limit}` con filtros `tabla, registroId, servicio, usuarioId, accion, dateFrom, dateTo` |
| `GET` | `/v1/auditoria/:id` | SessionGuard, Administrador y Auditor | Detalle de un evento con sus `cambios[]`; 404 si no existe |

Append-only: no hay rutas de UPDATE ni DELETE, y no debe haberlas.

Contrato con ejemplos: `docs/contratos/audit-service.md` + `audit-service.xsd`.

**Historial por entidad** = `GET /v1/auditoria?tabla=X&registroId=Y`. No
hay `findByEntity()` ni `GET /v1/auditoria/entity/:tipo/:id`: el contrato
lo resuelve con filtros (ver la sección del contrato). `registroId` va
siempre acompañado de `tabla` — la columna es TEXT y recibe UUID,
ObjectId e ids numéricos, así que sola puede mezclar entidades.

Lo que el `POST` valida (todo 400, no 500): `tabla` y `cambios[].campo`
≤ 80 caracteres (el ancho de su columna), `registroId` ≤ 200,
`descripcion` ≤ 1000, `previo`/`posterior` ≤ 2000, ≤ 50 cambios, `ip` una
IP válida (columna `INET`), `servicio` uno de los 10 microservicios,
`accion` del catálogo del ENUM, y **ningún `campo` repetido** dentro del
mismo evento (`PRIMARY KEY (auditoria_id, campo)`). El evento y sus
cambios se guardan en una transacción: no hay eventos a medias.

`dateFrom`/`dateTo` son días completos `YYYY-MM-DD` (inclusivos, en huso
UTC); con hora dan 400.

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

## Limitación conocida

`servicio` lo declara quien reporta. La lista cerrada de los 10 impide
inventar un emisor, pero una sesión válida puede firmar un evento como
otro servicio; acotarlo de verdad necesita autenticación
servicio-a-servicio (Parcial 3). El actor (`usuarioId`/`rolId`) sí es
confiable: sale del token verificado. Detalle en el contrato.
