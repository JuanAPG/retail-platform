# auth-service

Microservicio de autenticación (Node.js + TypeScript + NestJS, según el stack del proyecto). Implementa:

- Registro de **Proveedor externo** (único flujo de auto-registro; los roles internos los crea el Administrador).
- Login con correo y contraseña.
- Emisión de **access token** (corta duración) y **refresh token** (larga duración).
- Validación del access token vía `JwtStrategy` + `JwtAuthGuard` para proteger rutas en este y otros microservicios.
- Guard de rol (`RolesGuard` + `@Roles()`) para restringir endpoints por rol.

## Prerrequisitos

1. PostgreSQL 16 con el schema ya creado (`psql -f schema.sql`).
2. **La tabla `roles` debe tener al menos la fila `Proveedor`** insertada manualmente (schema.sql ya no trae datos semilla a propósito). Ejemplo mínimo:

3. **Al menos un usuario Administrador activo** para poder entrar la primera vez. `db/data_retail.sql` ya siembra uno (`admin@retail.mx` / `Passw0rd123!`); a partir de ahí, las demás cuentas se crean desde el Portal Admin con `POST /usuarios`.

## Instalación

```bash
npm install
cp .env.example .env   # y edita los valores, especialmente los secretos JWT
npm run start:dev
```

Swagger disponible en `http://localhost:3001/docs`.

> **Al desplegar en GCP**, el puerto 3001 debe habilitarse en dos capas: la regla de firewall de la VPC **y** `firewalld` dentro de la VM (CentOS 10). Si falta cualquiera de las dos, el front reporta "No se pudo conectar con el servidor" aunque el servicio esté corriendo bien. Comandos y verificación en el [README raíz](../README.md#despliegue-en-gcp).

## Endpoints

| Método | Ruta                       | Auth      | Descripción                                    |
|--------|----------------------------|-----------|-------------------------------------------------|
| POST   | `/auth/register/proveedor` | Pública   | Alta de empresa proveedora + su cuenta de acceso (queda inactiva hasta aprobación del Admin). |
| POST   | `/auth/login`               | Pública   | Devuelve `accessToken`, `refreshToken` y datos del usuario. |
| POST   | `/auth/refresh`             | Pública   | Cambia un `refreshToken` vigente por un nuevo `accessToken`. |
| GET    | `/auth/me`                  | Bearer JWT| Valida el token y retorna el usuario vigente (lo usa el front al recargar la página). |

### CRUD de usuarios (Portal Admin)

| Método | Ruta             | Roles                    | Descripción |
|--------|------------------|--------------------------|-------------|
| GET    | `/usuarios`      | Administrador, Auditor   | Lista todas las cuentas (sin `password_hash`). |
| GET    | `/usuarios/:id`  | Administrador, Auditor   | Detalle de una cuenta. |
| POST   | `/usuarios`      | Administrador            | Alta de cuenta interna con rol y contraseña (hash bcrypt). |
| PATCH  | `/usuarios/:id`  | Administrador            | Edición parcial: nombre, correo, rol, estado y/o contraseña. |
| DELETE | `/usuarios/:id`  | Administrador            | Baja definitiva. |
| GET    | `/roles`         | Administrador, Auditor   | Catálogo de roles para el selector del formulario. |

Reglas que aplica el servicio:

- Correo duplicado → `409`; rol inexistente → `400`.
- Un Administrador **no puede desactivarse, cambiarse de rol ni eliminarse a sí mismo** (`409`), para que nadie se deje fuera del sistema sin querer.
- Si el usuario tiene registros asociados (`productos.aprobado_por`, etc.), el `DELETE` devuelve `409` sugiriendo desactivarlo, en lugar de romper la integridad referencial o responder `500`.
- `password_hash` nunca sale en una respuesta.

### Ejemplo — login

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"mlopez@retail.mx","password":"TuPassword123"}'
```

Respuesta:

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "usuario": {
    "id": "b3f1...",
    "nombre": "María López Herrera",
    "email": "mlopez@retail.mx",
    "activo": true,
    "rol": "Administrador"
  }
}
```

### Ejemplo — ruta protegida

```bash
curl http://localhost:3001/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

## Cómo protegen rutas los OTROS microservicios

Cada microservicio de negocio (productos, precios, transacciones, etc.) debe usar el **mismo `JWT_ACCESS_SECRET`** configurado aquí para poder verificar el token sin llamar a este servicio en cada request (los microservicios son stateless respecto a auth). Reutiliza `JwtStrategy`, `JwtAuthGuard`, `RolesGuard` y `@Roles()` de este proyecto (cópialos o extráelos a un paquete/librería compartida si el monorepo lo permite).

Para el control fino de permisos por módulo (`Total` / `Lectura` / `Propone` / `Aprueba`, ver `rol_modulo_permiso` en `schema.sql`), cada microservicio de negocio debe consultar esa tabla — este servicio de autenticación solo resuelve identidad y rol, no la matriz completa de permisos.

## Pendiente para el segundo parcial (según Reglas de Negocio / stack)

- **Redis**: lista de tokens revocados (logout global, invalidación al desactivar un usuario) y almacenamiento de sesión.
- Endpoint de aprobación de proveedores pendientes (vive en el módulo "Catálogo de proveedores" del Portal Admin, no en este microservicio).
- Rotación de refresh tokens (invalidar el anterior al emitir uno nuevo).
