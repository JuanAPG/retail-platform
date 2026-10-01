# auth-service — identidad y sesiones (Sprint 2+3)

Dueño de `usuarios`, `roles`, `modulos`, `rol_modulo_permiso` y `proveedores`
(estas últimas por el registro). Parte de la plantilla transversal: health,
error estándar, logging, XML y `SessionGuard` ya vienen resueltos.

## Endpoints (`/v1/`, JSON y XML)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/v1/auth/register/proveedor` | pública | Alta proveedor+usuario inactivos |
| `POST` | `/v1/auth/login` | pública | Emite access+refresh con `jti`, guarda `session:{userId}` |
| `POST` | `/v1/auth/refresh` | pública | Rota el par (el anterior muere), exige sesión vigente |
| `POST` | `/v1/auth/logout` | SessionGuard | Borra sesión y revoca el refresh |
| `POST` | `/v1/auth/validate` | pública | Introspección `{active, user}` (fallback remoto) |
| CRUD | `/v1/usuarios` | Admin (lectura Admin+Auditor) | Alta, edición, baja |
| CRUD | `/v1/roles`, `/v1/roles/:id/permisos` | Admin (lectura Admin+Auditor) | 7 perfiles + matriz |

Contrato con ejemplos: `docs/contratos/auth-service.md` + `auth-service.xsd`.

## Redis (claves)

- `session:{userId}` → `{refreshJti, accessJti}`, expira con el refresh (7d).
- `revoked:{jti}` → `1`, expira con la vida restante del token.
- Sin sesión o con `jti` revocado → 401 aunque el token no expire.

## Correr y probar

```bash
npm install
PORT=3101 SERVICE_NAME=auth-service npm run start:dev
npm test                                   # unitarias (sin infra)
npm run test:integracion                   # requiere stack con seed (VM)
```

Diferencias con M01: tokens con `jti`, refresh con rotación real, logout con
revocación, sin Passport (las rutas usan `SessionGuard`), `bcryptjs` en vez de
`bcrypt` (sin compilación nativa en contenedores slim).
