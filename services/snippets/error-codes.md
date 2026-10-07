# Catálogo de códigos de error (`code`)

El campo `code` del cuerpo de error estándar solo admite estos valores.
Si tu caso no encaja en ninguno, usa `INTERNAL` y explícalo en `message`:
no inventes códigos por servicio.

| `code` | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400, 413 | DTO inválido, XSD que no valida, parámetros mal formados, archivo demasiado grande |
| `UNAUTHORIZED` | 401 | Sin token, token inválido/expirado o sesión cerrada en Redis |
| `FORBIDDEN` | 403 | Token válido pero rol sin permiso sobre el recurso |
| `NOT_FOUND` | 404 | El recurso pedido no existe |
| `CONFLICT` | 409 | Duplicado, folio/SKU repetido, transición de estado ilegal |
| `SERVICE_UNAVAILABLE` | 503 | Un microservicio del que dependes no responde (p. ej. catálogo caído) |
| `INTERNAL` | 500 | Todo lo demás (incluye fallos de BD, Redis o Mongo) |

`message` es siempre un string. El detalle de los 400 del `ValidationPipe`
viaja en `details` como arreglo de strings; en los demás errores `details`
es `null`.
