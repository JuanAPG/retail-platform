# Contrato: auth-service (Fase A — revisado en equipo antes de clientes)

Base: `http://auth-service:3101` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`auth-service.xsd`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}`.

> Cambio respecto a M01: los tokens llevan `jti` (revocación), el refresh
> rota el `jti` en vez de re-emitir solo el access, y existe
> `POST /v1/auth/logout` + `POST /v1/auth/validate`.

## Elemento raíz de cada respuesta en XML

El cliente de escritorio es XML-exclusivo y valida con el XSD, así que cada
ruta declara su elemento raíz. Hasta el 20-oct-2026 **ningún** handler lo
declaraba: todas las respuestas de éxito salían como `<response>`, que el XSD
no declara, y por eso ninguna validaba contra su propio contrato.

| Ruta | Elemento raíz |
|---|---|
| `POST /v1/auth/register/proveedor` | `registroProveedorResponse` |
| `POST /v1/auth/login` | `loginResponse` |
| `POST /v1/auth/refresh` | `refreshResponse` |
| `POST /v1/auth/logout` | `logoutResponse` |
| `POST /v1/auth/validate` | `validateResponse` |
| `GET /v1/usuarios` | `usuarioListResponse` |
| `GET /v1/usuarios/:id`, `POST /v1/usuarios`, `PATCH /v1/usuarios/:id` | `usuarioResponse` |
| `DELETE /v1/usuarios/:id` | `usuarioEliminadoResponse` |
| `GET /v1/roles` | `rolListResponse` |
| `GET /v1/roles/:id/permisos`, `PUT /v1/roles/:id/permisos` | `rolPermisosResponse` |
| cualquier error | `error` |

Dos notas sobre los tipos del XSD:

- El tipo `usuario` declara `createdAt` y `updatedAt` (opcionales) y lleva
  `activo` **antes** de `rol`, porque ese es el orden en que se emiten y
  `xs:sequence` es estricto. Antes el tipo los omitía y tenía el orden al
  revés, así que `loginResponse` no habría validado ni con el `@XmlRoot`
  puesto.
- El `user` de `validate` usa un tipo aparte, `usuarioDeToken`: se arma con el
  **payload del JWT** (`sub`, `email`, `rol`, `rolId`), así que no trae
  `nombre` ni `activo`, y es correcto que no los traiga — **D-26** dice que las
  respuestas llevan el id y que el nombre lo resuelve el cliente.

## POST /v1/auth/register/proveedor (pública)

Alta de proveedor + usuario inactivo (lo aprueba un Administrador).

Request JSON:

```json
{
  "nombreContacto": "Elena Ruiz",
  "razonSocial": "BioOrgánicos S.A.",
  "rfc": "BOR210615AB3",
  "telefono": "81 1234 5678",
  "email": "contacto@bioorganicos.mx",
  "password": "Passw0rd123!"
}
```

Response `201`:

```json
{ "mensaje": "Solicitud de registro enviada. Tu cuenta será revisada por el Administrador antes de activarse.",
  "proveedorId": "uuid", "usuarioId": "uuid" }
```

## POST /v1/auth/login (pública)

Request JSON:

```json
{ "email": "analista@retail.mx", "password": "Passw0rd123!" }
```

Response `200` (tokens con `jti`; además guarda `session:{userId}` en Redis):

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "usuario": { "id": "uuid", "nombre": "…", "email": "…", "rolId": 2, "rol": "Analista comercial", "activo": true }
}
```

Payload del access token: `{ sub, email, rol, rolId, jti }`. Del refresh:
`{ sub, jti, tokenType: "refresh" }`. Fallos → `401 UNAUTHORIZED` con mensaje
genérico (no enumeración), sin auditar el intento.

## POST /v1/auth/refresh (pública, con refresh token)

Request JSON: `{ "refreshToken": "<jwt>" }`

Response `200`: `{ "accessToken": "<jwt>", "refreshToken": "<jwt>" }`
(ambos rotados con `jti` nuevo; el anterior queda revocado).

## POST /v1/auth/logout (SessionGuard)

Borra `session:{userId}` y marca `revoked:{jti}` con TTL. Response `200`:
`{ "mensaje": "Sesión cerrada." }`. El access anterior muere aunque no expire.

## POST /v1/auth/validate (interna, fallback)

Para el servicio que prefiera validar remoto en vez de firma local + Redis.
Request JSON: `{ "token": "<jwt>" }`. Response `200`:
`{ "active": true, "user": { "id": "uuid", "email": "…", "rol": "…", "rolId": 1 } }`
o `{ "active": false, "user": null }` (nunca 401: la inactividad no es error).

## /v1/usuarios (Admin; lectura Admin+Auditor)

`GET /v1/usuarios` (paginado `{data,total,page,limit}`), `GET /v1/usuarios/:id`,
`POST /v1/usuarios` (alta con rol elegido, puede nacer activa),
`PATCH /v1/usuarios/:id`, `DELETE /v1/usuarios/:id`. Mismas validaciones que M01
(password con mayúscula/minúscula/número; nadie se desactiva ni se borra a sí mismo).

## /v1/roles y matriz (Admin; lectura Admin+Auditor para /v1/roles)

`GET /v1/roles` (los 8 perfiles, incluido el `Investigador de mercado` de D-28), `GET /v1/roles/:id/permisos` (matriz por rol:
`[{ modulo: "M06", nivel: "lectura" }]`), `PUT /v1/roles/:id/permisos`
(reemplaza la matriz: `[{ moduloId | clave, nivel }]` con niveles
`total | lectura_actualiza | lectura | propone | aprueba | lectura_propios | sin_acceso`).
