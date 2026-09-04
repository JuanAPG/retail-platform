# web-app

Aplicación web (React + TypeScript + Vite + Tailwind) de la Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista. Consume el backend de `auth-service` (login + catálogo de solo lectura).

## Instalación

```bash
cd web-app
npm install
cp .env.example .env
```

Edita `.env` si tu backend no corre en `http://localhost:3001`:
```
VITE_API_URL=http://localhost:3001
```

## Correr en desarrollo

```bash
npm run dev
```

Abre `http://localhost:5173`.

**Importante:** el backend (`auth-service`) debe estar corriendo antes de probar el login (`npm run start:dev` dentro de esa carpeta), y con CORS habilitado — ya lo está por defecto (`app.enableCors()` en `main.ts`).

## Manejo de la sesión

- Al iniciar sesión se guardan `accessToken`, `refreshToken` y `usuario` en `localStorage`.
- Al **recargar la página**, la app no confía en lo que quedó guardado: llama a `GET /auth/me` para confirmar que el token sigue vigente y que el usuario sigue activo. Mientras tanto se muestra una pantalla de "Verificando sesión…".
- Si el token expiró, el secreto rotó o el Administrador desactivó la cuenta, la sesión se limpia sola y se redirige a `/login`.
- Un 401 en `/auth/login` se muestra como error del formulario y **no** borra la sesión (eso solo aplica a rutas protegidas).
- Si el backend no responde, el mensaje lo dice explícitamente en vez de culpar a las credenciales.

## Build de producción

```bash
npm run build    # genera dist/
npm run preview  # sirve dist/ localmente para probarlo
```

## Mapa de portales (redirección automática tras login, según rol)

| Rol                     | Ruta          | Qué muestra |
|--------------------------|---------------|-------------|
| Administrador            | `/admin`      | **Inicio** (panel de bienvenida con indicadores), **Usuarios (CRUD completo)**, Tiendas, Zonas, Proveedores (datos reales); Auditoría (vacío) |
| Analista comercial       | `/analista`   | Transacciones/Segmentos/Canastas/Reglas/Accesibilidad (vacío, sin API aún); Productos y Tiendas de referencia (datos reales) |
| Gerente de categoría     | `/catalogo`   | Productos y Categorías (datos reales); **Aprobaciones de proveedor (aprobar/rechazar, funcional)**; Comparación/Reportes (vacío) |
| Responsable de precios   | `/catalogo`   | Mismo portal que Gerente, con secciones distintas: Precios/Aprobaciones/Elasticidad (vacío) |
| Planeador                | `/planeador`  | Nueva simulación/Historial (vacío); Productos de referencia (datos reales) |
| Auditor                  | `/auditor`    | Bitácora (vacío); Usuarios de referencia (datos reales) |
| Proveedor                | `/proveedor`  | **Mis productos (acotado por el backend), Proponer alta (funcional), Mis solicitudes** con el motivo de rechazo, Mi perfil |

### CRUD de usuarios (Portal Admin → Usuarios)

Es la única pantalla con operaciones de escritura conectadas al backend:

- **Crear**: botón "Nuevo usuario" → nombre, correo, contraseña, rol y estado.
- **Leer**: tabla con búsqueda por nombre/correo y filtros por rol y estado.
- **Actualizar**: "Editar" (solo manda los campos que cambiaron; la contraseña se conserva si se deja vacía) y "Activar/Desactivar" en un clic.
- **Eliminar**: con diálogo de confirmación. Si el backend responde que la cuenta tiene registros asociados, el diálogo muestra el motivo y sugiere desactivarla.

Sobre tu propia cuenta no se puede desactivar, cambiar de rol ni eliminar: esos botones aparecen deshabilitados y el backend lo rechaza igual.

### Acceso diferenciado por perfil

Además de decidir a qué portal entra cada rol, la aplicación diferencia el acceso en **tres niveles**, y los tres se aplican en el servidor:

1. **Por ruta** — el `RolesGuard` decide quién puede llamar a cada endpoint (`403` si no).
2. **Por dato** — `GET /productos` es la misma ruta para todos, pero un Proveedor recibe **solo los productos de su empresa**. El recorte lo hace la consulta SQL, no el navegador.
3. **Por acción** — leer y escribir están separados: Auditor, Analista y Planeador no tienen ninguna ruta de escritura habilitada.

El flujo que cruza dos perfiles y sirve para demostrarlo: **el Proveedor propone** un alta (queda `pendiente_aprobacion`) y **el Gerente de categoría la aprueba o la rechaza** con un motivo, que el proveedor ve de vuelta en «Mis solicitudes».

Las pantallas marcadas como "vacío" NO tienen datos porque las tablas correspondientes (`transacciones`, `auditoria`, simulaciones, `precios`) no fueron pobladas en `data_retail.sql` ni tienen un endpoint todavía — muestran un estado vacío explicativo en vez de datos inventados. Los endpoints de creación/edición (formularios reales conectados) tampoco existen aún: eso es el siguiente paso, módulo por módulo.

## Credenciales de prueba

Usa cualquiera de los 7 usuarios de `db/data_retail.sql`, todos con la contraseña `Passw0rd123!`:

```
admin@retail.mx
analista@retail.mx
gercategoria@retail.mx
precios@retail.mx
planeador@retail.mx
auditor@retail.mx
contacto@bioorganicos.mx    (rol Proveedor - BioOrgánicos)
ventas@lacteosdelnorte.mx   (rol Proveedor - Lácteos del Norte)
```

Hay **dos** proveedores a propósito: entrar con uno y luego con el otro demuestra que cada quien ve solo su propio catálogo.

## Estructura

```
src/
  api/          # axios + funciones de auth y catálogo
  context/      # AuthContext (sesión)
  routes/       # ProtectedRoute + mapa rol->portal
  components/   # TopBar, Sidebar, PortalLayout, DataTable, Badge, EmptyState, StatCard
  hooks/        # useFetch (GET con loading/error)
  pages/        # LoginPage, RegisterProveedorPage, y los 6 portales
    admin/      # panel de bienvenida y CRUD de usuarios
    catalogo/   # bandeja de aprobaciones del Gerente de categoría
  types/        # interfaces calcadas de las entidades del backend
```
