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

## Build de producción

```bash
npm run build    # genera dist/
npm run preview  # sirve dist/ localmente para probarlo
```

## Mapa de portales (redirección automática tras login, según rol)

| Rol                     | Ruta          | Qué muestra |
|--------------------------|---------------|-------------|
| Administrador            | `/admin`      | Usuarios, Tiendas, Zonas, Proveedores (datos reales); Auditoría (vacío) |
| Analista comercial       | `/analista`   | Transacciones/Segmentos/Canastas/Reglas/Accesibilidad (vacío, sin API aún); Productos y Tiendas de referencia (datos reales) |
| Gerente de categoría     | `/catalogo`   | Productos y Categorías (datos reales); Aprobaciones/Comparación/Reportes (vacío) |
| Responsable de precios   | `/catalogo`   | Mismo portal que Gerente, con secciones distintas: Precios/Aprobaciones/Elasticidad (vacío) |
| Planeador                | `/planeador`  | Nueva simulación/Historial (vacío); Productos de referencia (datos reales) |
| Auditor                  | `/auditor`    | Bitácora (vacío); Usuarios de referencia (datos reales) |
| Proveedor                | `/proveedor`  | Mis productos (filtrado por correo), Proponer alta, Mis solicitudes, Mi perfil |

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
contacto@bioorganicos.mx   (rol Proveedor)
```

## Estructura

```
src/
  api/          # axios + funciones de auth y catálogo
  context/      # AuthContext (sesión)
  routes/       # ProtectedRoute + mapa rol->portal
  components/   # TopBar, Sidebar, PortalLayout, DataTable, Badge, EmptyState, StatCard
  hooks/        # useFetch (GET con loading/error)
  pages/        # LoginPage, RegisterProveedorPage, y los 6 portales
  types/        # interfaces calcadas de las entidades del backend
```
