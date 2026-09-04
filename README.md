# Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista

Sistema web + microservicios + app móvil + app de escritorio para analizar
canastas de consumo por zona, ingreso y precio.

## Tecnologías

Hoy la aplicación son **dos piezas**: un backend modular (`auth-service`) y una SPA (`web-app`) que lo consume. Esto es lo que usa cada una realmente.

### Backend — `auth-service`

| Tecnología | Versión | Para qué se usa |
|---|---|---|
| Node.js | 20 | Entorno de ejecución (el Dockerfile usa `node:20-alpine`). |
| TypeScript | 5.5 | Todo el código fuente; se compila a `dist/` con `nest build`. |
| NestJS | 10.4 | Framework del backend: módulos, inyección de dependencias, guards y pipes. |
| TypeORM | 0.3.20 | ORM contra PostgreSQL. Corre con `synchronize: false`: el DDL manda, el ORM solo lee y escribe filas. |
| pg | 8.13 | Driver nativo de PostgreSQL. |
| @nestjs/jwt + Passport | 10.2 / 0.7 | Emisión y validación de JWT (`passport-jwt` extrae el `Bearer` de cada request). |
| bcrypt | 5.1 | Hash de contraseñas con costo 12. Módulo nativo — ver la nota de Docker más abajo. |
| class-validator + class-transformer | 0.14 / 0.5 | Validación de DTOs con `ValidationPipe` global (`whitelist` y `forbidNonWhitelisted` activos). |
| @nestjs/swagger | 7.4 | Documentación OpenAPI navegable en `/docs`. |
| @nestjs/config | 3.2 | Carga de `.env` y configuración tipada (`database`, `jwt`). |

**Organización interna** (monolito modular, un solo despliegue):

- `AuthModule` — registro de proveedor, login, refresh, `/auth/me`.
- `UsersModule` — CRUD de usuarios y catálogo de roles.
- `CatalogoModule` — lecturas de tiendas, zonas, municipios, categorías, productos y proveedores.
- `common/` — `JwtAuthGuard`, `RolesGuard`, decoradores `@Roles()` y `@CurrentUser()`.

### Frontend — `web-app`

| Tecnología | Versión | Para qué se usa |
|---|---|---|
| React | 18.3 | Interfaz de los portales por rol. |
| TypeScript | 5.5 | Tipos calcados de las entidades del backend (`src/types`). |
| Vite | 5.4 | Servidor de desarrollo y build de producción a `dist/`. |
| React Router | 6.26 | Ruteo y rutas protegidas por rol (`ProtectedRoute`). |
| axios | 1.7 | Cliente HTTP con interceptores: inyecta el `Bearer` y maneja los 401. |
| Tailwind CSS | 3.4 | Estilos, con PostCSS y autoprefixer. |

### Base de datos

- **PostgreSQL 16** — esquema versionado en `db/schema V2.sql`: UUID con `gen_random_uuid()`, tipos `ENUM` (`estatus_producto`, `formato_tienda`, `nivel_permiso`…), `CHECK` constraints y `TIMESTAMPTZ`.
- Datos de prueba en `db/data_retail.sql` (7 roles, 7 usuarios, tiendas, zonas, productos). Contraseña de todos los usuarios sembrados: `Passw0rd123!`.

### Infraestructura

- **Docker** — `auth-service/Dockerfile`, build multi-etapa sobre `node:20-alpine`.
- **GCP Compute Engine** — VM donde se expone el backend (ver despliegue abajo).

### Declarado en el proyecto, aún no usado

Python/FastAPI, Kotlin, Electron, MongoDB y Redis siguen en el plan del Parcial 2, pero **todavía no hay código de ninguno** en este repo.

## Cómo levantar el entorno local

### Opción A — con Docker (recomendada para empezar de cero)

Único requisito: Docker Desktop (o Docker Engine + Compose v2). No hace falta instalar Node ni PostgreSQL.

```bash
git clone <url-del-repo>
cd retail-platform

# Solo los servicios que hoy tienen código que los use
docker compose up -d postgres pgadmin api web

# Seguir el arranque (la primera vez tarda: instala dependencias)
docker compose logs -f api
```

Cuando el log del `api` diga `auth-service escuchando en http://localhost:3001`, entrar a http://localhost:5173 con `admin@retail.mx` / `Passw0rd123!`.

| Servicio | URL | Notas |
|---|---|---|
| Frontend | http://localhost:5173 | Vite en modo desarrollo |
| Backend | http://localhost:3001 | Swagger en `/docs` |
| PostgreSQL | `localhost:5432` | `retaildb` / `retail_user` / `retail_pass_2026` |
| pgAdmin | http://localhost:5050 | `admin@retail.com` / `admin_pass_2026` |

**El esquema y los datos de prueba se aplican solos** la primera vez que se crea el volumen de Postgres: `docker-compose.yml` monta `db/schema V2.sql` y `db/data_retail.sql` en `/docker-entrypoint-initdb.d`. No hay que correr `psql` a mano.

> Ese `initdb` **solo corre cuando el volumen se crea desde cero**. Si ya levantaste Postgres antes y cambias el SQL, hay que borrar el volumen para que se vuelva a aplicar:
> ```bash
> docker compose down -v && docker compose up -d postgres api web
> ```
> Cuidado: `-v` borra los datos. Es lo que quieres en desarrollo, nunca en la VM.

Para levantar además Mongo, Redis y sus consolas (declarados para el Parcial 2, todavía sin código que los use): `docker compose up -d`.

### Opción B — sin Docker, todo en el host

1. **Base de datos** — con PostgreSQL 16 corriendo, aplicar el esquema y los datos:
   ```bash
   psql -U retail_user -d retaildb -f "db/schema V2.sql"
   psql -U retail_user -d retaildb -f db/data_retail.sql
   ```
2. **Backend** (puerto **3001**):
   ```bash
   cd auth-service
   npm install
   cp .env.example .env    # editar DB_* y los secretos JWT
   npm run start:dev
   ```
   Swagger queda en http://localhost:3001/docs
3. **Frontend** (puerto **5173**):
   ```bash
   cd web-app
   npm install
   cp .env.example .env     # VITE_API_URL=http://localhost:3001
   npm run dev
   ```

Entrar en http://localhost:5173 con `admin@retail.mx` / `Passw0rd123!`.

> Las dos opciones se pueden mezclar: es común levantar solo la base con `docker compose up -d postgres pgadmin` y correr la API y el front en el host. Por eso las credenciales de `auth-service/.env.example` coinciden con las del `docker-compose.yml`.

## Despliegue en GCP

La aplicación expone **dos puertos**, y ninguno de los dos está abierto por omisión. Cada uno hay que habilitarlo en **dos capas independientes** (regla de VPC en GCP + `firewalld` dentro de la VM); si falta cualquiera de las cuatro combinaciones, el servicio parece caído aunque esté corriendo perfecto dentro de la VM.

| Puerto | Quién lo usa | Síntoma si está cerrado |
|--------|--------------|--------------------------|
| **3001** | `auth-service` (API NestJS) | La página **sí carga**, pero el login responde "No se pudo conectar con el servidor" |
| **5173** | `web-app` (Vite en modo dev) | El navegador **se queda cargando en blanco** y nunca muestra nada |

Los dos síntomas son distintos y sirven para saber cuál puerto revisar. Abrir solo el 3001 —el caso más común, porque es el que suele documentarse— deja el front inaccesible desde fuera de la VM.

### 1. Regla de firewall de la VPC (nivel GCP)

Desde Cloud Shell o con `gcloud` autenticado:

```bash
# Crear la regla de ingreso para el puerto 3001
gcloud compute firewall-rules create allow-auth-service-3001 \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:3001 \
  --target-tags=retail-api \
  --source-ranges=0.0.0.0/0 \
  --description="auth-service (NestJS) - API de la plataforma retail"

# Crear la regla de ingreso para el puerto 5173 (front en modo dev)
gcloud compute firewall-rules create allow-web-app-5173 \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:5173 \
  --target-tags=retail-api \
  --source-ranges=0.0.0.0/0 \
  --description="web-app (Vite dev server) - front de la plataforma retail"

# Etiquetar la VM para que las reglas le apliquen
gcloud compute instances add-tags NOMBRE_DE_LA_VM \
  --tags=retail-api \
  --zone=ZONA_DE_LA_VM

# Verificar que las reglas existen y con qué puertos quedaron
gcloud compute firewall-rules list --filter="targetTags.list():retail-api" \
  --format="table(name,allowed[].map().firewall_rule().list(),targetTags.list())"
```

> El error más fácil de cometer aquí es abrir un puerto equivocado (por ejemplo `5001` en vez de `5173`). La regla se crea sin quejarse y todo *parece* configurado, pero el tráfico real sigue descartándose. El `firewall-rules list` de arriba muestra el puerto que quedó realmente guardado.

También se puede hacer desde la consola web: **VPC network → Firewall → Create firewall rule**, con `Targets: Specified target tags` = `retail-api`, `Source IPv4 ranges` = `0.0.0.0/0` y `Protocols and ports: TCP 3001`.

> `0.0.0.0/0` deja el puerto abierto a todo internet. Para las pruebas de clase es lo práctico; si el equipo quiere restringirlo, basta sustituirlo por las IP desde las que se conectan. Además, el servicio hoy va por HTTP sin TLS, así que los JWT viajan en claro — para la entrega final conviene ponerle un proxy con HTTPS.

### 2. Firewall del sistema operativo — CentOS 10 (dentro de la VM)

La regla de GCP deja pasar el tráfico hasta la VM, pero **firewalld** todavía puede rechazarlo. La VM del proyecto corre **CentOS 10**, que trae `firewalld` activo por omisión.

```bash
# 1. Confirmar que firewalld está corriendo y en qué zona está la interfaz
sudo systemctl status firewalld
sudo firewall-cmd --get-active-zones      # en una VM de GCP suele ser "public"

# 2. Abrir el puerto de forma permanente en esa zona
sudo firewall-cmd --permanent --zone=public --add-port=3001/tcp
sudo firewall-cmd --permanent --zone=public --add-port=5173/tcp

# 3. Aplicar los cambios (sin --reload, la regla permanente NO entra en vigor)
sudo firewall-cmd --reload

# 4. Verificar
sudo firewall-cmd --zone=public --list-ports   # debe incluir 3001/tcp y 5173/tcp
```

Dos detalles de `firewalld` que cuestan tiempo si se pasan por alto:

- **`--permanent` sin `--reload` no hace nada** en la sesión actual: la regla queda guardada en disco pero el firewall sigue con la configuración vieja. Al revés (sin `--permanent`) la regla funciona ya, pero se pierde al reiniciar la VM.
- Si `--get-active-zones` devuelve una zona distinta de `public`, hay que usar esa misma en los comandos; abrir el puerto en la zona equivocada deja el tráfico bloqueado sin ningún mensaje de error.

**Sobre SELinux:** CentOS 10 viene con SELinux en `enforcing`. Para el caso actual —el proceso de Node lanzado desde la shell o por una unidad systemd sin tipo confinado— **no hace falta tocar nada**: un proceso no confinado puede escuchar en el 3001 sin problema. SELinux sí se vuelve relevante en dos escenarios posteriores: si más adelante se pone **nginx/httpd como proxy** habrá que habilitar sus conexiones salientes (`sudo setsebool -P httpd_can_network_connect 1`) y, si ese proxy escucha directamente en el 3001, etiquetar el puerto (`sudo semanage port -a -t http_port_t -p tcp 3001`). Antes de culpar a SELinux, conviene revisarlo con `sudo ausearch -m AVC -ts recent`, que muestra si realmente bloqueó algo.

### 3. Verificar que quedó abierto

```bash
# Dentro de la VM: ambos procesos deben escuchar en 0.0.0.0, no en 127.0.0.1
ss -tlnp | grep -E '3001|5173'

# Dentro de la VM: los servicios responden localmente
curl -s -o /dev/null -w "api  -> %{http_code}\n" http://localhost:3001/docs
curl -s -o /dev/null -w "web  -> %{http_code}\n" http://localhost:5173/

# Desde tu máquina: la misma respuesta a través de la IP externa
curl -s -o /dev/null -w "api  -> %{http_code}\n" http://IP_EXTERNA_DE_LA_VM:3001/docs
curl -s -o /dev/null -w "web  -> %{http_code}\n" http://IP_EXTERNA_DE_LA_VM:5173/
```

Si responde dentro de la VM pero no desde fuera, el problema es de firewall (una de las dos capas). Si `ss` muestra `127.0.0.1:5173` en vez de `0.0.0.0:5173`, el dev server solo acepta conexiones locales: por eso `web-app/vite.config.ts` fija `server.host = true` (equivalente a `npm run dev -- --host`). NestJS ya escucha en todas las interfaces por omisión.

Para distinguir **cuál** de las dos capas está bloqueando, desde tu máquina:

```bash
nc -zv IP_EXTERNA_DE_LA_VM 3001
nc -zv IP_EXTERNA_DE_LA_VM 5173
```

Cómo leer el resultado — la diferencia importa:

| Resultado | Significado |
|-----------|-------------|
| `succeeded!` | El puerto está abierto en las dos capas y hay algo escuchando |
| **Se queda colgado** (timeout) | Los paquetes se **descartan**: falta la regla de la VPC en GCP, o está creada con otro puerto/etiqueta |
| `Connection refused` | La VPC deja pasar; el bloqueo es de `firewalld` (que rechaza) o el servicio no está arriba |

El timeout es exactamente el síntoma que produce la página "cargando para siempre" en el navegador: sin respuesta que rechace la conexión, el navegador espera hasta agotar su propio tiempo límite.

### 4. Apuntar el frontend a la VM

En `web-app/.env`:

```
VITE_API_URL=http://IP_EXTERNA_DE_LA_VM:3001
```

**`localhost` aquí no sirve.** Esta URL la resuelve el **navegador**, que corre en la máquina de quien entra a la página — no dentro de la VM. Si queda `http://localhost:3001`, el navegador buscará un backend en la computadora del usuario y el login fallará con "No se pudo conectar con el servidor", aunque la API esté perfecta en la VM.

Vite lee esta variable **al arrancar**, no en caliente: hay que reiniciar `npm run dev` (o volver a correr `npm run build` si se sirve el `dist/`) para que el cambio tenga efecto. Conviene reservar una IP externa **estática** en GCP; con una IP efímera hay que reescribir el `.env` y reiniciar el front cada vez que se reinicia la VM.

> El `vite` en modo dev es cómodo para la demo, pero no está pensado para exponerse a internet. Para la entrega final: `npm run build` y servir `dist/` con nginx en el puerto 80.

### Nota sobre Docker

`auth-service/Dockerfile` expone el 3001, pero antes de usarlo en la VM hay dos detalles pendientes:

- `bcrypt` es un módulo nativo y `node:20-alpine` (musl) no tiene binarios precompilados: hay que agregar `RUN apk add --no-cache python3 make g++` en la etapa de build, cambiar a `node:20-slim`, o migrar a `bcryptjs`.
- La imagen final no incluye `.env`, así que las variables (`DB_*`, secretos JWT) deben pasarse con `-e` o `--env-file`. Sin los secretos JWT el contenedor no arranca. Y `DB_HOST=localhost` dentro de un contenedor apunta al contenedor mismo, no al host.

## Estructura del repo

```
retail-platform/
├── auth-service/       # Backend NestJS (auth + usuarios + catálogo) — puerto 3001
│   ├── src/
│   └── Dockerfile
├── web-app/            # Frontend React/Vite — puerto 5173
│   └── src/
├── db/
│   ├── schema V2.sql   # DDL de PostgreSQL
│   └── data_retail.sql # Datos de prueba
├── docker-compose.yml  # Entorno de desarrollo completo
├── .gitignore
├── README.md
└── CONTRIBUTING.md
```

Planeado para el Parcial 2, todavía sin código en el repo: `mobile/` (Kotlin), `desktop/` (Electron), `services/` (microservicios independientes) y `docs/` (diagramas C4, modelo de datos, matriz de perfiles y permisos).

## Equipo
Juan Angel Galván Navarro — Arquitectura / DevOps
Leonardo Rangel Castro — Backend Web
Pamela Rodríguez de la Rosa — Datos / Algoritmos
Fernando Olivares del Valle — Apps cliente
