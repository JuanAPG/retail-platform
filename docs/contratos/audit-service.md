# Contrato: audit-service (Fase A — revisado en equipo antes de clientes)

Base: `http://audit-service:3110` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`audit-service.xsd`). Errores con el cuerpo estándar.

> El `POST` lo usa el `AuditReporter` de cada microservicio que reporta
> eventos: `pricing-service`, `core-process-service`,
> `notifications-service` y `auth-service`. El reportero REENVÍA el
> `Authorization` del usuario que originó el evento: `usuarioId`/`rolId`
> nunca van en el cuerpo, siempre salen del token.
>
> En `auth-service`, login/refresh reenvían el `accessToken` que ellos
> mismos acaban de emitir (la sesión ya existe en Redis para ese
> momento); logout reporta ANTES de borrar su propia sesión (si lo
> hiciera después, su propio token ya no tendría sesión que validar); el
> alta de proveedor NO reporta nada — es un formulario público sin
> sesión, y la activación posterior por un Administrador ya queda
> auditada vía `PATCH /v1/usuarios/:id`.

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

`servicio` admite **solo los 10 microservicios** de la plataforma
(`auth-service`, `catalog-service`, `pricing-service`,
`core-process-service`, `algorithms-core`, `analytics-stats`,
`decision-service`, `documents-service`, `notifications-service`,
`audit-service`); cualquier otro valor es 400, igual que una `accion`
fuera del catálogo. Es el mismo valor que el `AuditReporter` de cada
servicio manda como constante y que `SERVICE_NAME` fija en
`infra/docker-compose.yml`. Si se agrega un microservicio, se agrega aquí
y en `src/common/servicios.ts`.

Topes de longitud (400 si se pasan): `tabla` y `cambios[].campo` 80
caracteres —el ancho real de sus columnas—, `registroId` 200,
`descripcion` 1000, `previo`/`posterior` 2000 y `cambios` 50 entradas.
`ip` debe ser una IP válida (la columna es `INET`).

**Un evento no puede repetir el mismo `cambios[].campo`**: 400. La tabla
tiene `PRIMARY KEY (auditoria_id, campo)` porque un evento registra un
antes/después por campo; dos cambios al mismo campo son dos eventos. El
evento y sus `cambios` se escriben en una sola transacción: no existe un
evento guardado sin los campos que declaró.

### Limitación conocida: `servicio` lo declara quien reporta

El `POST` no exige rol a propósito, así que **cualquier sesión válida
puede reportar en nombre de cualquiera de los 10 servicios**: la lista
cerrada impide inventar un emisor, no impide que un Proveedor firme un
evento como `auth-service`. Acotarlo de verdad exige autenticación
servicio-a-servicio (token de servicio o red privada con mTLS), que es
trabajo del Parcial 3.

Mientras tanto la bitácora conserva con qué identidad se escribió cada
evento: `usuarioId` y `rolId` salen SIEMPRE del token verificado, nunca
del cuerpo. Un evento que dice `servicio: "auth-service"` con
`rolId` = Proveedor es exactamente eso, un evento no confiable, y así se
detecta. Al leer la bitácora como evidencia (RF-30), el `servicio` es una
declaración del emisor; el actor es el dato duro.

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
`servicio` (uno de los 10), `usuarioId` (UUID), `accion` (del catálogo),
`dateFrom`, `dateTo`, `page` (default 1), `limit` (default 20, máx 100).
Un filtro que no existe o un valor fuera de catálogo es 400, no una lista
vacía.

`total` cuenta EVENTOS, no filas: una página de 20 trae 20 eventos aunque
cada uno traiga varios `cambios`.

**`dateFrom` y `dateTo` son días completos, formato `YYYY-MM-DD`, los dos
inclusivos.** No se admite hora (`2026-10-10T15:00:00Z` es 400): antes
entraba y cada extremo la interpretaba distinto —`dateFrom` respetaba la
hora y `dateTo` la tiraba, incluyendo el día entero—, así que un rango de
horas devolvía días. El día se resuelve en el **huso de Postgres**, que en
`infra/docker-compose.yml` es UTC: en Monterrey (UTC-6) los eventos de
después de las 18:00 locales caen en el día UTC siguiente. Para el
Parcial 2 se deja así y documentado; si el equipo quiere días locales, es
una decisión de contrato (un parámetro de huso o fijar
`America/Monterrey` en la sesión de la base), no un parche en el filtro.

Historial por entidad: `GET /v1/auditoria?tabla=precios&registroId=<id>`.
Eventos de un emisor: `GET /v1/auditoria?servicio=pricing-service`.

> **`registroId` siempre va con `tabla`.** La columna es TEXT y recibe
> UUID (catálogo, usuarios), ObjectId de Mongo (reportes, notificaciones)
> e ids numéricos (precios, transacciones), así que `?registroId=42` sin
> `tabla` puede mezclar el precio 42 con la transacción 42. El índice
> `idx_auditoria_tabla_registro` es `(tabla_afectada, registro_id)`, en
> ese orden, justo porque la consulta útil lleva las dos.

Cada evento trae `cambios[]` (`campo`, `valorPrevio`, `valorPosterior`).

## GET /v1/auditoria/:id (SessionGuard, Administrador y Auditor)

Detalle de un evento, con sus `cambios[]`. `404` si no existe —incluido un
id que no es numérico (el id es `BIGSERIAL`), para no devolver un 500 de
Postgres. Raíz XML `auditEventResponse`.

## Historial por entidad: no hay `GET /v1/auditoria/entity/:tipo/:id`

El requerimiento original de la rama pedía
`AuditService.findByEntity(entityType, entityId)` y
`GET /audit/entity/:type/:id`. **No existen, y es deliberado:** este
contrato resuelve el historial por entidad con los filtros
`?tabla=&registroId=`, que es lo mismo con un endpoint menos y además
compone con los otros filtros (`accion`, rango de fechas, emisor). Si
alguien compara el requerimiento con el código, no falta una función:
sobra una línea en el requerimiento, que queda cerrada aquí.
