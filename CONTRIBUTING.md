# Convenciones del equipo — Sprint 2+3 (microservicios)

## Arquitectura: 10 microservicios + 3 clientes

El backend ya no es un monolito: `api/` queda congelado como fuente de extracción y
cada frente vive en su propia carpeta con su propio contenedor. La web es un cliente
más, no un microservicio.

| Frente | Carpeta | Responsable | Rama | Depende de |
|---|---|---|---|---|
| Plantilla transversal | `services/` (base) | Juan Angel | `feature/infra-estandar` | Ninguna (se abre primera) |
| auth-service | `services/auth-service/` | Juan Angel | `feature/auth-service` | infra-estandar |
| audit-service | `services/audit-service/` | Juan Angel | `feature/audit-service` | infra-estandar |
| catalog-service | `services/catalog-service/` | Pamela | `feature/catalog-service` | infra-estandar, auth-service |
| notifications-service | `services/notifications-service/` | Juan Angel | `feature/notifications-service` | infra-estandar, catalog-service |
| pricing-service | `services/pricing-service/` | Pamela | `feature/pricing-service` | infra-estandar, catalog-service |
| core-process-service | `services/core-process-service/` | Juan Angel | `feature/core-process-service` | infra-estandar, auth-service, catalog-service |
| algorithms-core | `services/algorithms-core/` | Leonardo | `feature/algorithms-core` | infra-estandar, core-process-service, pricing-service |
| documents-service | `services/documents-service/` | Pamela | `feature/documents-service` | infra-estandar, core-process-service |
| analytics-stats (Python) | `services/analytics-stats/` | Leonardo | `feature/analytics-stats` | infra-estandar, core-process-service |
| decision-service | `services/decision-service/` | Fernando | `feature/decision-service` | infra-estandar, pricing-service, algorithms-core |
| web ampliado | `web/` | Pamela | `feature/web-ampliado` | catalog, pricing, documents funcionales |
| app móvil (Kotlin) | `mobile/` | Fernando | `feature/app-movil` | auth, catalog, pricing, core-process funcionales |
| app escritorio (Electron) | `desktop/` | Fernando | `feature/app-escritorio` | auth, core-process, algorithms-core, catalog funcionales |

Orden sugerido de apertura: infra-estandar → auth-service, audit-service →
catalog-service, notifications-service → pricing-service, core-process-service →
algorithms-core, documents-service → analytics-stats, decision-service →
web-ampliado, app-movil, app-escritorio. Nadie abre una rama que necesite un
servicio sin contrato definido.

## Cómo arrancar tu frente

**No partas de cero: parte de `feature/infra-estandar`.** Trae la plantilla NestJS
y la plantilla FastAPI con `/v1/health`, manejo de errores, logging, snippet de
validación JWT + Redis y Dockerfile base ya resueltos. Para apps cliente, parte
del scaffolding que deja Fernando en Fase B (auth + navegación base).

```
services/<tu-servicio>/
├── src/                 # o app/ en FastAPI
├── Dockerfile           # propio, desde la plantilla (no inventes otro)
└── README.md            # cómo levantarlo solo + su /v1/health
```

Regla de oro: toca **solo tu carpeta** (`services/<tuyo>/`, `mobile/`, `desktop/` o
tu parte de `web/`). Los archivos compartidos están listados abajo: avisa antes de
tocarlos. Si necesitas algo de un frente ajeno que aún no existe, no lo escribas
tú — pídelo en el chat del equipo.

## Archivos compartidos: coordinar antes de tocar

| Archivo | Por qué |
|---|---|
| `infra/docker-compose.yml` | Lo coordina Juan Angel. 10 servicios + postgres/mongo/redis; un cambio de puerto o variable rompe a todos |
| Formato de error / logging / health | Definidos en `feature/infra-estandar`. **No inventes el propio** en tu servicio |
| `docs/contratos/` | JSON+XSD por endpoint, se acuerdan en Fase A antes que los clientes |
| `db/schema.sql` | Postgres compartido con tablas por dueño: solo agregas TUS tablas |
| `web/src/App.tsx` y `web/src/routes/` | Rutas y mapa de portales (frente web) |
| `web/src/types/index.ts` | Interfaces calcadas de los contratos, no de entidades internas |
| `mobile/` y `desktop/` tipos y clientes HTTP | Un solo cliente por app; móvil JSON exclusivo, escritorio XML exclusivo con XSD |

## Cambios al esquema de datos

Postgres compartido, `synchronize: false`, `db/schema.sql` fuente de verdad. Solo
agregas las tablas de TU servicio y avisas al equipo para recrear volúmenes.
MongoDB: colecciones `reportes` (documents-service) y `notificaciones`
(notifications-service), con índice por fecha/usuario. Redis: sesiones, revocados,
caché de catálogos, rate-limit — todos los servicios lo consultan al autorizar.

## Modelo de datos heredado (no se renegocia)

- Precios, inventario y líneas de venta cuelgan de la **PRESENTACIÓN**, no del producto.
- `transacciones_detalle` guarda `presentacion_id`; el producto sale por join.
- Segmentos por **zona agregada**; nunca inferir ingreso individual.
- Toda salida calculada cuelga de una corrida (parámetros + supuestos + filtros).
- Auditoría append-only; cambios en `auditoria_cambios`, no en JSON.

## Reglas de permisos y estándar transversal

- JWT validado contra `auth-service` **más** sesión activa en Redis. Sin esa
  consulta, el token no vale aunque firme bien.
- Rutas `/v1/`, mismo cuerpo de error, `GET /v1/health`, logging por operación,
  Swagger con ejemplos JSON **y** XML.
- Móvil = JSON exclusivo; escritorio = XML exclusivo validado con XSD.
- Nombres de rol con las constantes compartidas, nunca literales. Cambios a la
  matriz también en `docs/matriz-perfiles-permisos.docx` (avisar al equipo).

## Flujo de trabajo paso a paso

### Una sola vez, al empezar

```bash
git clone https://github.com/JuanAPG/retail-platform.git
cd retail-platform

# Que tus commits salgan a TU nombre. El profesor revisa esto.
git config user.name  "Tu Nombre Completo"
git config user.email "tu-correo-de-github@ejemplo.com"
git config --get user.email     # verifica antes del primer commit
```

### Cada vez que empiezas algo

```bash
# 1. Parte SIEMPRE de main actualizado.
git checkout main
git pull origin main

# 2. Crea tu rama con el nombre que te toca (ver tabla de arriba)
git checkout -b feature/auth-service

# 3. Trabaja. Commits pequeños y frecuentes, no uno gigante al final.
git add services/auth-service
git commit -m "feat(auth-service): emite JWT y guarda sesión en Redis"

# 4. Sube tu rama (la primera vez con -u; después basta `git push`)
git push -u origin feature/auth-service
```

Luego abre el Pull Request en GitHub: **Compare & pull request** → base `main`,
compare tu rama.

### Mantener tu rama al día (cada dos o tres días, sin colchón no hay de otra)

```bash
git checkout main
git pull origin main
git checkout feature/auth-service
git merge main
git push
```

Se usa `merge` y no `rebase` a propósito: `rebase` reescribe la historia y obliga a
`push --force`, que si alguien más ya bajó tu rama le destruye el trabajo.

### Después de que aprueben tu PR

```bash
git checkout main
git pull origin main
git branch -d feature/auth-service          # borra la local
```

La rama remota se borra sola si está activado *Automatically delete head branches*.

## Gate obligatorio antes de abrir cualquier PR

Si tu frente no cumple esto, el PR se regresa sin revisar:

- El servicio compila y levanta con `docker compose up` sin errores.
- Responde en `/v1/health`.
- Swagger con ejemplo de petición/respuesta en JSON **y** en XML.
- Usa el formato estándar de error de `feature/infra-estandar`.
- Valida JWT contra auth-service y consulta Redis (sesión activa).
- Al menos una prueba unitaria y una de integración.
- Apps: contra servicios reales, no mocks. Móvil: cámara y GPS probables en
  dispositivo o emulador. Escritorio: XML real validado con XSD.
- Si tocaste un archivo compartido, lo avisas en la descripción del PR.

## Ramas (GitHub Flow)

- `main` siempre desplegable, protegida (requiere PR + 1 aprobación)
- Ramas: `feature/<servicio-o-frente>` en minúsculas con guiones (ver tabla)
- Se borran al hacer merge
- Actualiza tu rama con `main` cada dos o tres días
- Una rama = un frente = un PR. No mezcles dos frentes en la misma rama

## Commits (Conventional Commits con alcance del servicio)

```
feat(auth-service): emite JWT y guarda sesión en Redis
fix(pricing-service): corrige histórico por presentación
docs: actualiza contratos de catalog-service
chore: agrega Redis a docker-compose
refactor(decision-service): simplifica cálculo de accesibilidad
```

**Cada quien hace commits con su propia cuenta de Git.** Commits atribuidos a otra
identidad, o documentación sin commits de código real, no cuentan como participación.
Verifica con:

```bash
git config user.name && git config user.email
```

## Pull Requests

- Título claro con el frente: `feat(auth-service): login con sesión en Redis`
- Descripción de qué y por qué, y cómo probarlo (contra qué servicios y con qué
  usuario/rol, qué debe verse en Swagger en JSON y en XML)
- Ligar el PR a la tarea del Sprint Backlog
- **Mínimo 1 aprobación** antes de mergear a `main`. Nadie aprueba su propio PR
- El CI tiene que pasar en verde
- Criterios por frente en la tabla de ramas (ej. core-process-service: que
  algorithms-core lea canastas reales; decision-service: simulación completa con
  datos reales de pricing y algorithms-core)

### Al revisar el PR de alguien más

- Descarga la rama y córrela, no solo leas el diff
- Revisa que no haya tocado carpetas de otros frentes ni inventado su propio
  formato de error, versionado o health
- Si agregó tablas, que sean solo las suyas y estén en `db/schema.sql`
- Comenta lo que veas raro; aprobar sin leer no cuenta como participación

## Verificación local y demo end-to-end (Fase D)

```bash
docker compose -f infra/docker-compose.yml up -d
curl localhost:3001/v1/health   # cada servicio en su puerto
```

La demo cruza móvil (JSON) → microservicios + Redis/Mongo/Postgres → web →
escritorio (XML). Si falta tiempo, recortar en este orden: push móvil real, Excel
con formato en escritorio, locks en Redis, cobertura fuera de
auth/core/algorithms. **No se recorta:** JSON+XML en los 10, 4+ microservicios por
app, Redis en la autenticación de todos, demo end-to-end.

Front en su puerto Vite, Swagger en cada servicio (`/docs`). Credenciales de prueba
en [web/README.md](web/README.md). GCP y Secret Manager, hasta el Parcial 3.
