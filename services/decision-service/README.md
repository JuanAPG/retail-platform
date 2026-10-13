# Plantilla NestJS transversal (Sprint 2+3)

Base de los 9 microservicios NestJS. Ya resuelve lo transversal — **no se
modifica por servicio**, solo se agregan módulos de negocio.

## Qué trae resuelto

- `GET /v1/health` sin auth (`src/health/`)
- Error estándar `{ statusCode, message, code, details, path, timestamp }`
  (`src/common/filters/`, catálogo en `services/snippets/error-codes.md`)
- Logging JSON por operación (`src/common/interceptors/logging.interceptor.ts`)
- XML si `Accept: application/xml` (`xml.interceptor.ts`; XSD en `docs/contratos/`)
- `SessionGuard`: JWT + `revoked:{jti}` + `session:{userId}` en Redis
  (`src/common/auth/`). Aplicar con `@UseGuards(SessionGuard)`.

## Roles y bitácora (decision-service)

| Endpoint | Roles |
|---|---|
| `POST /v1/simulation/price` | Planeador |
| `POST /v1/simulation/presentation` | Planeador |
| `POST /v1/recommendations/generate` | Planeador |
| `GET /v1/recommendations` (paginado; filtros `zoneId`, `status`) | Perfiles internos (lectura) |
| `PATCH /v1/recommendations/:id/approve` | Gerente de categoría |
| `PATCH /v1/recommendations/:id/reject` (body `motivo`, 10–500) | Gerente de categoría |
| `GET /v1/accessibility/index` | Administrador, Analista |
| `GET` de escenarios, compare, explain y by-zone | Perfiles internos (lectura) |

Según la matriz de permisos, el Planeador escribe en M13 y M14;
Administrador y Analista solo leen ahí. D-12: genera el Planeador, decide
el Gerente de categoría. `generate` reemplaza las recomendaciones en
`propuesta` del alcance evaluado; las aceptadas y descartadas se conservan.

Cada simulación queda en la bitácora de audit-service con acción `simular`,
cada recomendación generada con `generar_recomendacion` (una entrada por
recomendación), cada decisión del Gerente con `aprobar` o `rechazar`, y
cada cálculo del índice de accesibilidad con
`ejecutar_corrida` (`src/common/audit/`, requiere `AUDIT_SERVICE_URL`). Se
reenvía el `Authorization` del usuario; si audit-service falla, la operación
no se rompe.

Avisos (D-12, `src/common/notifications/`, requiere
`NOTIFICATIONS_SERVICE_URL`): cada escenario guardado avisa
`escenario.generado` a quien simuló; `generate`, `recomendacion.generada` al
Gerente de categoría; aprobar o rechazar, `recomendacion.resuelta` al
Planeador (el Auditor recibe copia automática desde notifications-service).
También se reenvía el `Authorization` del usuario y un fallo del aviso no
rompe la operación.

## Pruebas

```bash
npm test                 # unitarias (src/**/*.spec.ts), sin stack
npm run test:integracion # test/*.spec.ts contra el stack real
```

Las de integración necesitan el stack local levantado con el seed (desde la
raíz del repo):

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis auth-service catalog-service \
  core-process-service algorithms-core audit-service decision-service
```

- `test/contrato-xml.spec.ts`: pide cada endpoint con `Accept: application/xml`
  y valida la respuesta real (y un 400 y un 404) contra
  `docs/contratos/decision-service.xsd`. Necesita **`xmllint`** en el PATH o,
  si no está, **Python 3 con `lxml`** (`pip install lxml`); sin ninguno de
  los dos la prueba falla diciendo qué instalar. La simulación de precio
  requiere una elasticidad ya calculada (`POST /v1/elasticity/calculate` en
  algorithms-core).
- `test/roles.spec.ts`: matriz de roles de simular, generar, aprobar y
  rechazar con las 7 cuentas semilla. No crea datos.

Solo corren contra la base local. Borran lo que crean (escenarios,
recomendaciones, corridas de accesibilidad) y restauran las `propuesta` que
`generate` haya reemplazado; los eventos de la bitácora se quedan
(append-only). Variables opcionales: `DECISION_BASE_URL`
(`http://localhost:3107`), `AUTH_BASE_URL` (`http://localhost:3101`) y
`DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`.

## Cómo copiarme a un servicio nuevo (5 pasos)

```bash
cp -r services/template-nest services/<nuevo-servicio>
cd services/<nuevo-servicio>
# 1. En .env.example y docker-compose: fija PORT y SERVICE_NAME
# 2. Agrega tus módulos (controladores con rutas que cuelguen de /v1/)
# 3. Protege rutas con @UseGuards(SessionGuard) (health queda abierto)
# 4. Documenta en Swagger con ejemplos JSON y XML
# 5. npm install && npm run build && curl localhost:<PORT>/v1/health
```

## Probarla sola

```bash
npm install
PORT=3000 SERVICE_NAME=plantilla-test npm run start:dev
curl localhost:3000/v1/health
curl localhost:3000/v1/no-existe              # error estándar 404
curl -H 'Accept: application/xml' localhost:3000/v1/health
```
