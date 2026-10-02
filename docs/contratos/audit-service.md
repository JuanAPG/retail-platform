# Contrato: audit-service (Fase A — revisado en equipo antes de clientes)

Base: `http://audit-service:3110` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`audit-service.xsd`). Errores con el cuerpo estándar.

> Este contrato lo exige el `AuditReporter` de `auth-service`: el `POST`
> acepta **exactamente** la forma de abajo. Los demás servicios reportan
> igual cuando empiecen en Fase B.

## POST /v1/auditoria (red privada, sin guard)

Registra un evento. Nunca devuelve error por contenido (si la forma es
válida): la auditoría es append-only y secundaria.

Request JSON:

```json
{
  "tabla": "usuarios",
  "registroId": "uuid-del-usuario",
  "accion": "update",
  "descripcion": "Usuario actualizado (a@x.mx).",
  "cambios": [{ "campo": "activo", "previo": "true", "posterior": "false" }],
  "usuarioId": "uuid-del-actor",
  "rolId": 1,
  "ip": "172.18.0.5"
}
```

`accion` solo admite `insert | update | delete | login | importacion`.
Todo campo salvo `tabla` y `accion` puede ser `null` (evento sin actor o
sin registro, pero nunca sin tabla ni acción).

Response `201`: `{ "id": "123" }` (id numérico del evento).

## GET /v1/auditoria (SessionGuard, Administrador y Auditor)

Bitácora paginada `{data, total, page, limit}`, de la más reciente a la
más antigua. Filtros (todos opcionales): `tabla`, `registroId`,
`usuarioId`, `accion`, `dateFrom`, `dateTo` (inclusivo, día completo),
`page` (default 1), `limit` (default 20, máx 100).

Historial por entidad: `GET /v1/auditoria?tabla=precios&registroId=<id>`.

Cada evento trae `cambios[]` (`campo`, `valorPrevio`, `valorPosterior`).
