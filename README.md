# decision-service — accesibilidad, simulación y recomendaciones (M12 + M13 + M14)

Microservicio NestJS que convierte el análisis en decisiones comerciales:

- **Accesibilidad (RF-23):** índice por zona que combina precio, ingreso del
  segmento, disponibilidad y productos básicos. Es un indicador analítico, no
  una medida absoluta de bienestar.
- **Simulación (RF-24, RF-25, RF-26):** escenarios de cambio de precio y de
  presentación, con demanda e ingreso proyectados a partir de la elasticidad
  calculada (D-01), y comparación entre escenarios.
- **Recomendaciones:** motor de reglas, sin IA. Cada recomendación explica
  qué recomienda, por qué, con qué datos y qué impacto estima (D-12, D-13).

Puerto **3107** · rutas bajo `/v1/` · JSON por defecto y XML con
`Accept: application/xml` (XSD en `docs/contratos/decision-service.xsd`) ·
Swagger en `http://localhost:3107/docs` · contrato en
`docs/contratos/decision-service.md`.

## Endpoints y roles

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/health` | Público |
| GET | `/v1/accessibility/index` | Administrador, Analista comercial |
| GET | `/v1/accessibility/by-zone/:zoneId` | Perfiles internos (lectura) |
| POST | `/v1/simulation/price` | Planeador |
| POST | `/v1/simulation/presentation` | Planeador |
| GET | `/v1/simulation/scenarios` | Perfiles internos (lectura) |
| GET | `/v1/simulation/compare` | Perfiles internos (lectura) |
| GET | `/v1/recommendations` (paginado; filtros `zoneId`, `status`) | Perfiles internos (lectura) |
| POST | `/v1/recommendations/generate` | Planeador |
| GET | `/v1/recommendations/:id/explain` | Perfiles internos (lectura) |
| PATCH | `/v1/recommendations/:id/approve` | Gerente de categoría |
| PATCH | `/v1/recommendations/:id/reject` (body `motivo`, 10–500 caracteres) | Gerente de categoría |

El Proveedor no tiene acceso a ninguna ruta. Según la Matriz
(`docs/matriz-perfiles-permisos.md`), el Planeador escribe en simulación y
recomendaciones y los demás perfiles internos solo leen. D-12: genera el
Planeador y decide el Gerente de categoría. `generate` reemplaza las
recomendaciones en `propuesta` del alcance evaluado; las aceptadas y
descartadas se conservan.

## Estructura

```
src/
├── accessibility/     índice por zona y desglose por componente
├── simulation/        escenarios de precio y presentación, comparación
├── recommendations/   motor de reglas, explicación, aprobación y rechazo
├── entities/          tablas propias (TypeORM)
├── common/
│   ├── auth/          SessionGuard: JWT + revoked:{jti} + session:{userId} en Redis
│   ├── guards/        RolesGuard
│   ├── audit/         AuditReporter → audit-service (fire-and-forget)
│   ├── notifications/ NotificationsReporter → notifications-service (fire-and-forget)
│   ├── filters/       error estándar { statusCode, message, code, details, path, timestamp }
│   └── interceptors/  logging por operación y respuesta XML
└── health/            GET /v1/health
```

## Persistencia (PostgreSQL)

Tablas propias (solo este servicio las escribe): `accesibilidad_zona`,
`accesibilidad_componentes`, `accesibilidad_pesos`, `escenarios`,
`escenario_cambios`, `escenario_resultados`, `recomendaciones`,
`recomendacion_evidencias`.

Lee en modo solo lectura precios, productos, presentaciones, zonas, segmentos,
inventario, transacciones y `elasticidades` de la base compartida.

## Integración

- **audit-service:** cada simulación queda en la bitácora con acción
  `simular`; cada recomendación generada con `generar_recomendacion` (una
  entrada por recomendación); cada decisión del Gerente con `aprobar` o
  `rechazar`; y cada cálculo del índice de accesibilidad con
  `ejecutar_corrida`. Requiere `AUDIT_SERVICE_URL`.
- **notifications-service:** cada escenario guardado avisa
  `escenario.generado` a quien simuló; `generate` avisa
  `recomendacion.generada` al Gerente de categoría; aprobar o rechazar avisa
  `recomendacion.resuelta` al Planeador (el Auditor recibe copia automática).
  Requiere `NOTIFICATIONS_SERVICE_URL`.
- En ambos casos se reenvía el `Authorization` del usuario, y si el servicio
  destino falla la operación original no se rompe.

## Variables de entorno

| Variable | Valor en `infra/docker-compose.yml` |
|---|---|
| `PORT` | `3107` |
| `SERVICE_NAME` | `decision-service` |
| `JWT_ACCESS_SECRET` | secreto compartido de desarrollo |
| `REDIS_HOST` / `REDIS_PORT` | `redis` / `6379` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `postgres` / `5432` / credenciales de desarrollo / `retaildb` |
| `AUDIT_SERVICE_URL` | `http://audit-service:3110` |
| `NOTIFICATIONS_SERVICE_URL` | `http://notifications-service:3109` |

## Levantarlo

Con el stack completo, desde la raíz del repo:

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis auth-service \
  audit-service notifications-service decision-service
curl http://localhost:3107/v1/health
```

## Pruebas

```bash
npm test                 # unitarias (src/**/*.spec.ts), sin stack
npm run test:integracion # test/*.spec.ts contra el stack real
```

Las de integración necesitan el stack local levantado con el seed:

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
