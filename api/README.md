# api — Backend monolito modular

Backend único de la plataforma (Node.js + TypeScript + NestJS + TypeORM). **No es un microservicio**: todos los módulos de negocio corren en el mismo proceso, sobre la misma base de datos y bajo el mismo puerto. La extracción a microservicios está pospuesta a propósito hasta el Parcial 2 (ver [CLAUDE.md](../CLAUDE.md)).

## Cómo está organizado

Cada módulo de negocio es una carpeta bajo `src/` con sus propios controladores, servicios y DTO. Lo compartido vive en tres lugares y **solo ahí**:

| Carpeta | Qué contiene | Regla |
|---|---|---|
| `src/common/` | Guards (`JwtAuthGuard`, `RolesGuard`), decoradores (`@Roles`, `@CurrentUser`) y los nombres de rol (`roles.ts`) | No pongas lógica de negocio aquí |
| `src/config/` | Configuración de base de datos y JWT | |
| `src/entities/` | Entidades TypeORM | Una entidad por tabla, compartida entre módulos |

Los módulos de M05 en adelante están **vacíos y registrados** en `app.module.ts`. Al implementar el tuyo no hace falta tocar ese archivo: agrega `imports`, `controllers` y `providers` dentro de tu propio `*.module.ts`.

### Autenticación

Implementa:

- Registro de **Proveedor externo** (único flujo de auto-registro; los roles internos los crea el Administrador).
- Login con correo y contraseña.
- Emisión de **access token** (corta duración) y **refresh token** (larga duración).
- Validación del access token vía `JwtStrategy` + `JwtAuthGuard` para proteger rutas en cualquier módulo del monolito.
- Guard de rol (`RolesGuard` + `@Roles()`) para restringir endpoints por rol.
- Reutilizables por todos los módulos de negocio desde `src/common/`.

## Prerrequisitos

1. PostgreSQL 16 con el schema ya creado (`psql -f ../db/schema.sql`).
2. **La tabla `roles` debe tener al menos la fila `Proveedor`** insertada manualmente (schema.sql ya no trae datos semilla a propósito). Ejemplo mínimo:

3. **Al menos un usuario Administrador activo** para poder entrar la primera vez. `../db/data_retail.sql` ya siembra uno (`admin@retail.mx` / `Passw0rd123!`); a partir de ahí, las demás cuentas se crean desde el Portal Admin con `POST /usuarios`.

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

### Catálogo y flujo de alta de producto (acceso diferenciado)

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/productos` | Todos | **Devuelve distinto según el perfil**: un Proveedor recibe únicamente los productos de su propia empresa; los perfiles internos ven el catálogo completo. |
| GET | `/productos/pendientes` | Administrador, Gerente de categoría | Bandeja de propuestas por revisar. |
| POST | `/productos` | **Proveedor** | Propone un alta. Nace en `pendiente_aprobacion` y ligada a su empresa. |
| PATCH | `/productos/:id/aprobar` | Administrador, Gerente de categoría | Pasa la propuesta a `activo` y registra quién la resolvió. |
| PATCH | `/productos/:id/rechazar` | Administrador, Gerente de categoría | Pasa a `rechazado`; exige `motivoRechazo`. |
| GET | `/tiendas`, `/zonas`, `/municipios` | Los 6 perfiles internos | Referencia territorial; el Proveedor no accede. |
| GET | `/categorias-producto` | Todos | Única lectura abierta al Proveedor: la necesita para elegir categoría al proponer. |
| GET | `/proveedores` | Administrador, Analista comercial, Gerente de categoría, Auditor | Padrón de empresas proveedoras. |

Reglas que aplica el servicio:

- **El recorte por proveedor se hace en la consulta, no en el front.** Filtrar en el navegador sería cosmético: la respuesta HTTP seguiría trayendo el catálogo de todos y bastaría abrir la pestaña de red para verlo.
- El vínculo usuario↔empresa es el **correo** (`usuarios.email` = `proveedores.email`, ambos UNIQUE); `usuarios` no tiene FK a `proveedores`.
- `proveedorId` y `estatus` **no se aceptan en el cuerpo** de `POST /productos`: los fija el servidor a partir del token. Mandarlos hace que el `ValidationPipe` global (`forbidNonWhitelisted`) rechace la petición — si no, un proveedor podría dar de alta productos a nombre de otro.
- `esCanastaBasica` tampoco lo decide el proveedor: es una clasificación de negocio (RN-04) del Gerente de categoría.
- Una propuesta ya resuelta no se puede volver a resolver → `409`, para que dos revisores no se sobrescriban.
- Proveedor con empresa inactiva → `403`; SKU duplicado → `409`; categoría inexistente → `400`.

### Ejemplo — login

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@retail.mx","password":"Passw0rd123!"}'
```

Respuesta:

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "usuario": {
    "id": "b3f1...",
    "nombre": "María López Herrera",
    "email": "admin@retail.mx",
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

## Cómo proteger rutas en un módulo nuevo

Dentro del monolito no hay que verificar tokens a mano ni compartir secretos entre procesos: basta reutilizar lo que ya vive en `src/common/`.

```ts
@ApiTags('M0X Nombre del módulo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)   // el orden importa: Jwt primero
@Controller('mi-recurso')
export class MiController {
  @Get()
  @Roles(...PERFILES_INTERNOS)          // de src/common/roles.ts
  findAll(@CurrentUser() usuario: UsuarioSolicitante) { ... }
}
```

Reglas que conviene respetar para que los permisos se mantengan coherentes entre los cuatro módulos que se desarrollan en paralelo:

- **Usa las constantes de `src/common/roles.ts`**, nunca literales. `'Gerente de categoría'` escrito a mano con un acento distinto compila igual y abre un hueco silencioso.
- **Un método sin `@Roles()` queda abierto a cualquier usuario autenticado.** Es un default deliberado, pero decídelo: si la ruta no es para todos, decláralo.
- **El recorte por dueño del dato va en la consulta, no en el front.** Ver `ProductsService.findProductos()` como referencia: un Proveedor solo recibe sus productos porque el `where` lo filtra, no porque la pantalla lo esconda.
- **Nunca aceptes en el cuerpo un campo que decide el servidor** (el dueño del registro, el estatus inicial, quién aprobó). El `ValidationPipe` global rechaza campos no declarados en el DTO; apóyate en eso.

El control fino de la matriz de permisos por módulo (`Total` / `Lectura` / `Propone` / `Aprueba`, tabla `rol_modulo_permiso`) todavía no está implementado: hoy el guard resuelve el nivel "¿puede entrar a esta ruta?". Cuando se implemente, será un solo guard compartido en `src/common/`, no uno por módulo.

## Pendiente para el segundo parcial (según Reglas de Negocio / stack)

- **Redis**: lista de tokens revocados (logout global, invalidación al desactivar un usuario) y almacenamiento de sesión.
- Endpoint de aprobación de proveedores pendientes (la empresa, no la cuenta de acceso: hoy se puede activar el usuario desde el CRUD, pero el registro de `proveedores` sigue sin flujo de aprobación).
- Rotación de refresh tokens (invalidar el anterior al emitir uno nuevo).
