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

3. **Al menos un usuario Administrador activo**, creado directamente en la base (este servicio no expone un endpoint para crear administradores — eso vive en el microservicio de Usuarios/Portal Admin, `Total` según la matriz de permisos). Genera su hash con bcrypt (`saltRounds=12`) antes de insertarlo.

## Instalación

```bash
npm install
cp .env.example .env   # y edita los valores, especialmente los secretos JWT
npm run start:dev
```

Swagger disponible en `http://localhost:3001/docs`.

## Endpoints

| Método | Ruta                       | Auth      | Descripción                                    |
|--------|----------------------------|-----------|-------------------------------------------------|
| POST   | `/auth/register/proveedor` | Pública   | Alta de empresa proveedora + su cuenta de acceso (queda inactiva hasta aprobación del Admin). |
| POST   | `/auth/login`               | Pública   | Devuelve `accessToken`, `refreshToken` y datos del usuario. |
| POST   | `/auth/refresh`             | Pública   | Cambia un `refreshToken` vigente por un nuevo `accessToken`. |
| GET    | `/auth/me`                  | Bearer JWT| Ejemplo de ruta protegida; retorna el usuario decodificado del token. |

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
