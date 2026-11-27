# recommendations-workflow-service (puerto 3117) · D-41

Seguimiento de las recomendaciones **aceptadas** en decision-service: el **Gerente de
categoría asigna** un responsable, **el responsable asignado** la inicia y la marca
implementada, y el **Gerente evalúa** el impacto con una métrica (ventas en unidades, ventas
en importe o precio unitario) comparando un periodo antes y uno después.

```
(recomendación ACEPTADA) ─► asignada ─► en_implementacion ─► implementada ─► evaluada
```

- Contrato (fuente de verdad):
  [`docs/contratos/recommendations-workflow-service.md`](../../docs/contratos/recommendations-workflow-service.md)
  y [`.xsd`](../../docs/contratos/recommendations-workflow-service.xsd) (namespace `workflow/v1`).
- Decisiones: D-41, D-12, D-26, D-46.
- Base: `services/template-nest/` (correlación, error estándar, XML, `SessionGuard`, health).
  El lector de cuerpos XML es la misma idea que promotion-service y decision-service.

## Rutas

| Método | Ruta | Quién |
|---|---|---|
| POST | `/v1/workflow/assignments` | Gerente de categoría |
| GET | `/v1/workflow/assignments` (`status`, `assigneeUserId`, `recommendationId`, `mine=true`) | Los 6 perfiles internos |
| GET | `/v1/workflow/assignments/:id` | Los 6 perfiles internos |
| PATCH | `/v1/workflow/assignments/:id/start` | **Solo el usuario asignado** (rol Analista, Responsable de precios o Planeador) |
| PATCH | `/v1/workflow/assignments/:id/implement` | **Solo el usuario asignado** |
| PATCH | `/v1/workflow/assignments/:id/evaluate` | Gerente de categoría |
| GET | `/v1/workflow/assignments/:id/history` | Los 6 perfiles internos |
| GET | `/v1/health` | Sin autenticación (`health.xsd`) |

`:id` es el id del **seguimiento**. Proveedor e Investigador → 403. Swagger con ejemplos JSON y
XML en `/docs`.

- **Asignar:** verifica por HTTP en decision-service
  (`GET /v1/recommendations/:id/explain`, 3 s) que la recomendación esté `aceptada`. Un solo
  seguimiento por recomendación: repetir con el mismo responsable → `200` con el existente
  (sin auditar ni avisar); con otro → `409`.
- **Mover estados:** solo hacia adelante y de uno en uno; salto o repetición → `409` con el
  estado actual y el pedido en `details`. Cada transición es un `UPDATE … WHERE estado =
  '<desde>'` (atómica).
- **Evaluar:** `variationPct = (después − antes) / antes × 100`, redondeado a 2 decimales al
  final (lo calcula el servidor). Casos de control en `src/seguimiento/reglas.spec.ts`:
  1,000 → 1,150 = 15.00; 27.50 → 25.00 = −9.09; base 0 → 400.
- **Cuerpos XML** (`asignacionRequest`, `implementacionRequest`, `evaluacionRequest`): los
  guards corren ANTES de leer el XML; `DOCTYPE`/`ENTITY`, raíz o namespace equivocados o XML
  mal formado → 400; más de 1 MB → 413.

## Base de datos

Tablas **nuevas**, sin llave foránea a `recomendaciones` ni a `usuarios`:
`recomendacion_seguimientos` (uno por recomendación) y `seguimiento_eventos` (en
`db/schema.sql`, sección 15c). Una base que ya existía necesita la migración (idempotente):

```bash
# Git Bash
docker exec -i retail_postgres psql -U retail_user -d retaildb < db/migraciones/sprint4_recommendations_workflow.sql
```

```powershell
# PowerShell (no acepta "<")
Get-Content db/migraciones/sprint4_recommendations_workflow.sql | docker exec -i retail_postgres psql -U retail_user -d retaildb
```

## Correr

```bash
npm install
cp .env.example .env     # fuera de Docker: DECISION_SERVICE_URL=http://localhost:3107
npm run build && npm run start:prod
curl -i localhost:3117/v1/health
```

Sin `DECISION_SERVICE_URL` el servicio **no arranca** y lo dice.

## Pruebas

```bash
npm test                  # unitarias: casos de control, unidades, periodos, estados, XML contra el XSD
npm run test:integracion  # contra el stack local (Postgres con la migración, Redis, auth, decision)
```

La integración prepara recomendaciones **solo con rutas reales de decision-service** (lista
las `propuesta`; si no hay 3, el Planeador genera; el Gerente aprueba una y rechaza otra) y
borra al final sus seguimientos. Lo que hizo en decision-service se queda (aprobar y rechazar
son historial de decisiones). Si falta un servicio o la migración, **falla** diciendo qué.

## Para Juan Ángel: bloque de `infra/docker-compose.yml`

No se editó `infra/`. Bloque listo para agregar:

```yaml
  recommendations-workflow-service:
    image: node:20
    container_name: retail_recommendations_workflow_service
    working_dir: /app
    volumes:
      - ../services/recommendations-workflow-service:/app
      - /app/node_modules
    environment:
      PORT: 3117
      SERVICE_NAME: recommendations-workflow-service
      SERVICE_VERSION: 1.0.0
      # targetNamespace de su XSD: el XmlInterceptor lo pone como
      # xmlns en la raiz para que el XML valide contra docs/contratos/.
      XML_NAMESPACE: workflow/v1
      JWT_ACCESS_SECRET: dev_access_secret_solo_para_local
      REDIS_HOST: redis
      REDIS_PORT: 6379
      BUSINESS_TIMEZONE: America/Monterrey
      AUTH_SERVICE_URL: http://auth-service:3101
      # Verifica que la recomendacion este aceptada (obligatoria).
      DECISION_SERVICE_URL: http://decision-service:3107
      # No bloqueantes (1.5 s): auditoria y avisos seguimiento.asignado / .avance / .evaluado.
      AUDIT_SERVICE_URL: http://audit-service:3110
      NOTIFICATIONS_SERVICE_URL: http://notifications-service:3109
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: retail_user
      DB_PASSWORD: retail_pass_2026
      DB_NAME: retaildb
    ports:
      - "3117:3117"
    command: sh -c "npm install && npm run start:dev"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      decision-service:
        condition: service_started
```

También le toca (§10, bloqueante para auditar y avisar): agregar
`recommendations-workflow-service` a `servicio` de audit-service y a `sourceService` de
notifications-service, y los eventos `seguimiento.asignado`, `seguimiento.avance` y
`seguimiento.evaluado` (informativos, D-46: se pueden apagar; `seguimiento.evaluado` con copia
al rol Auditor). Mientras no estén, esas llamadas responden 400: la operación se completa y
queda `fallido` en `/:id/history` y un `WARN aviso_fallido` en el log.

## Fila de la Matriz §3.2 (para copiar)

| Módulo | Admin | Analista | Gerente | Resp. precios | Planeador | Auditor | Proveedor | Investigador |
|---|---|---|---|---|---|---|---|---|
| Seguimiento de recomendaciones (recommendations-workflow-service, D-41) | L | L + mueve estados si es el asignado | **Asigna y evalúa** (+ L) | L + mueve estados si es el asignado | L + mueve estados si es el asignado | L | – | – |

D-41 fija "el Gerente asigna y evalúa; el responsable asignado mueve los estados". Las
lecturas y qué roles se pueden asignar son **PROPUESTA** (contrato §2).
