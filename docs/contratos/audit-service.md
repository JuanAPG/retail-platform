# Contrato: audit-service (Fase A — revisado en equipo antes de clientes)

Base: `http://audit-service:3110` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`audit-service.xsd`). Errores con el cuerpo estándar.

> El `POST` lo usa el `AuditReporter` de cada microservicio que reporta
> eventos (hoy: `pricing-service`, `core-process-service`,
> `notifications-service`). El reportero REENVÍA el `Authorization` del
> usuario que originó el evento: `usuarioId`/`rolId` nunca van en el
> cuerpo, siempre salen del token.
>
> **Pendiente:** el `AuditReporter` de `auth-service` (login, refresh,
> logout, alta de proveedor, altas/bajas de usuarios y roles) todavía
> manda `usuarioId`/`rolId` en el cuerpo y sin `Authorization` — con este
> contrato, sus reportes van a fallar en silencio (best-effort) hasta que
> se actualice. Casos a resolver ahí antes de tocarlo: login/refresh
> pueden reenviar el token recién emitido (la sesión ya existe en Redis
> en ese punto); logout reporta DESPUÉS de borrar su propia sesión, así
> que necesita reportar antes de borrarla; el alta de proveedor no tiene
> ningún usuario autenticado todavía.

## POST /v1/auditoria (SessionGuard, cualquier perfil autenticado)

Registra un evento a nombre del usuario del token. Exige sesión válida
(JWT + `session:{userId}` en Redis); sin eso, 401. No hay restricción de
rol adicional: un Proveedor puede reportar sus propias acciones (p. ej.
proponer un precio), igual que cualquier perfil interno.

Request JSON:

```json
{
  "tabla": "usuarios",
  "registroId": "uuid-del-usuario",
  "servicio": "pricing-service",
  "accion": "update",
  "descripcion": "Usuario actualizado (a@x.mx).",
  "cambios": [{ "campo": "activo", "previo": "true", "posterior": "false" }],
  "ip": "172.18.0.5"
}
```

`tabla`, `servicio` y `accion` son obligatorios. `usuarioId` y `rolId`
**no se aceptan en el cuerpo**: si llegan, `forbidNonWhitelisted` responde
400 (el actor siempre sale del token, nunca de lo que mande el cliente).
Todo campo salvo `tabla`, `servicio` y `accion` puede ser `null`.

`accion` admite:

| Acción | Cuándo usarla |
|---|---|
| `insert` | Alta de un registro (precio, propuesta, transacción, notificación...). |
| `update` | Modificación de un registro existente. |
| `delete` | Baja lógica o eliminación de un registro. |
| `login` | Inicio/cierre/renovación de sesión (uso de `auth-service`). |
| `importacion` | Confirmación de una importación CSV. |
| `aprobar` | Resolución positiva de una propuesta o solicitud (p. ej. propuesta de precio aprobada). |
| `rechazar` | Resolución negativa de una propuesta o solicitud. |
| `desactivar` | Baja lógica explícita de una entidad (proveedor, producto, usuario). |
| `ejecutar_corrida` | Corrida de un algoritmo (Apriori, elasticidad, sustitución). |
| `simular` | Simulación de `decision-service`. |
| `generar_recomendacion` | Generación de una recomendación comercial. |
| `exportar` | Exportación de un reporte (PDF/Excel) u otro artefacto. |

Response `201`: `{ "id": "123" }` (id numérico del evento).

## GET /v1/auditoria (SessionGuard, Administrador y Auditor)

Bitácora paginada `{data, total, page, limit}`, de la más reciente a la
más antigua. Filtros (todos opcionales): `tabla`, `registroId`,
`servicio`, `usuarioId`, `accion`, `dateFrom`, `dateTo` (inclusivo, día
completo), `page` (default 1), `limit` (default 20, máx 100).

Historial por entidad: `GET /v1/auditoria?tabla=precios&registroId=<id>`.
Eventos de un emisor: `GET /v1/auditoria?servicio=pricing-service`.

Cada evento trae `cambios[]` (`campo`, `valorPrevio`, `valorPosterior`).
