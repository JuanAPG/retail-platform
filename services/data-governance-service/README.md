# data-governance-service (3119 · T-14)

Gobierno de datos (D-43): **fuentes** de datos y sus **versiones**, **linaje** de cada importación,
versión de segmento y corrida ("¿de dónde salió este resultado?"), **calidad** por fuente y
**retención** (políticas, evaluación y simulación).

- Contrato: [`docs/contratos/data-governance-service.md`](../../docs/contratos/data-governance-service.md)
  y su XSD (namespace `governance/v1`); ejemplos en `docs/contratos/ejemplos/data-governance-*`.
- Parte de `services/template-fastapi/` (T-02: `X-Correlation-Id`, health con dependencias,
  error estándar, JSON/XML según `Accept`, sesión JWT + Redis).
- Swagger en `/docs`, con ejemplos JSON y XML de éxito y de error en las 14 rutas.
- Tablas propias en el Postgres compartido (D-47); migración en
  [`db/migraciones/sprint4_data_governance.sql`](../../db/migraciones/sprint4_data_governance.sql).
  Sin MongoDB; Redis solo para la sesión.

## Rutas y permisos (Matriz §3.2)

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/sources`, `/v1/sources/:key`, `/v1/sources/:key/versions` | 6 perfiles internos |
| POST, PATCH | `/v1/sources`, `/v1/sources/:key`, `/v1/sources/:key/versions` | Administrador |
| POST | `/v1/lineage` (201 la primera vez, 200 si ya existía igual, 409 si cambia) | Analista, Resp. de precios, Planeador |
| GET | `/v1/lineage`, `/v1/lineage/:id`, `/v1/lineage/:id/origin` | Administrador y Auditor todo; Analista, Gerente, Resp. de precios y Planeador **solo lo propio** (lo ajeno → `404`) |
| GET | `/v1/quality-report` | Administrador, Auditor, Analista |
| GET | `/v1/retention-policies`, `/v1/retention/evaluation` | Administrador, Auditor |
| POST | `/v1/retention/simulate` | Administrador, Auditor |
| GET | `/v1/health` | Sin auth; `postgres` y `redis` (`mongodb`: `no configurado`) |

Proveedor e Investigador de mercado → `403` en todas.

## Cómo está armado

| Módulo | Regla | Qué hace |
|---|---|---|
| `app/repositorio.py` | DG-1 a DG-3, DG-6 | SQL plano con pool; linaje idempotente en una transacción (la restricción única decide si dos llegan a la vez); versión nueva → `origin: linaje` |
| `app/origen.py` | DG-5, DG-6 | Árbol hacia atrás hasta 5 niveles, ciclos cortados, `registered: false`, `restricted: true` |
| `app/retencion.py` | DG-9 a DG-11 | Plazos ISO en calendario (29-feb + 3 años = 1-mar), vence el mismo día, corte de la evaluación, simulación |
| `app/calidad.py` | DG-7, DG-8 | Métricas con numerador y denominador; frescura 7/365 días; sin datos → `disponible: false`, nunca 0 |
| `app/fuentes.py`, `app/informes.py` | DG-7, DG-10 | Lecturas a ingestion, core-process, availability e income-segmentation; un dueño caído deja solo su fuente sin medir (no 503) |
| `app/avisos.py` | — | Bitácora de alta y cambio de fuente y de alta de versión (el linaje no se audita) |
| `app/gobierno_api.py` | DG-4 | Rutas, validación de cuerpos (formato del id según el tipo de recurso) y permisos |

Decisiones del dominio tomadas al implementar (dentro del contrato):

- **Llave foránea a `usuarios`** en `usuario_id` y `creado_por`, como el resto del esquema (y la
  bitácora). Las sembradas quedan con `creado_por` nulo.
- **Solo se anexa también en la base:** triggers impiden `UPDATE`/`DELETE` en versiones, linaje e
  insumos, y el `DELETE` de una fuente (se desactiva).
- **Completitud y fuera de rango de `ventas-archivo`:** ingestion no expone `rejectedByCode`; se leen
  las filas solo de los lotes con rechazos (hasta 5 000 por lote). Más que eso → `disponible: false`.
- **Ventana de lotes y último confirmado:** ingestion no filtra por fecha ni da `confirmedAt`; se
  filtra por `createdAt` en hora de Monterrey.
- **Raíz XML por método:** `GET /v1/sources` → `sourceListResponse`, `POST` → `sourceResponse`
  (igual en `/v1/lineage` y en versiones).

## Probar

```bash
pip install -r requirements-dev.txt
python -m pytest                      # 117 pruebas; las de PostgreSQL se saltan sin DB_HOST_PRUEBAS
```

Con PostgreSQL (crea un esquema temporal `gob_pruebas_<pid>` / `gob_api_<pid>`, le aplica la
migración y lo borra: nunca toca las tablas de `public`; usa los usuarios del seed):

```bash
DB_HOST_PRUEBAS=localhost DB_PASSWORD=retail_pass_2026 python -m pytest
```

En el mismo Python del Dockerfile, desde la raíz del repo y en la red del stack:

```bash
docker run --rm --network retail-platform_retail_net -v "$PWD":/repo \
  -w /repo/services/data-governance-service -e DB_HOST_PRUEBAS=postgres -e DB_PASSWORD=retail_pass_2026 \
  python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && python -m pytest"
```

| Archivo | Qué prueba |
|---|---|
| `tests/test_dominio.py` | Retención (29-feb, mismo día, bitácora; **la simulación es idéntica al ejemplo del contrato**; propiedad corte ⇔ vencido), calidad, frescura 7/8 y 365/366, árbol (5 niveles, ciclo, sin registrar, restringido) |
| `tests/test_repositorio.py` | Postgres real: 201→200→409, versión `linaje`, fuente inactiva → 400, **4 registros iguales a la vez → 1 creado**, DG-6, Postgres caído → 503 |
| `tests/test_informes.py` | Los 4 dueños simulados: lotes en hora de Monterrey, rechazos por código, reporte y evaluación del ejemplo, dueño caído o sin permiso |
| `tests/test_api.py` | Las 14 rutas: permisos de los 8 roles, DG-6, árbol de origen, validaciones, **todo XML validado contra el XSD** (incluidos 67 ejemplos de Swagger) |

## Medido en vivo (local, 26-nov-2026)

Por HTTP, con usuarios del seed, Postgres, core-process, income-segmentation, audit-service y
**demand-forecast-service real** apuntando a este servicio:

| Caso | Resultado |
|---|---|
| Pronóstico en 3116 (correlación `vivo-d43-1`) | 3116 registró su linaje aquí solo: fuente `ventas-core-process`, versión = SHA-256 de la serie, misma correlación |
| `GET /v1/lineage/:id/origin` | Fuente, versión (`origin: linaje`), quién y cuándo: el caso de control de D-43 |
| Mismo linaje otra vez / otro contenido | `200` / `409` |
| Gerente pide el registro del Analista / Auditor | `404` / `200` (DG-6) |
| Evaluación con `asOf` 2029-09-01 | 7 638 transacciones vencerían (igual al conteo directo en Postgres) |
| Calidad con ingestion y availability apagados | Esas dos fuentes `disponible: false` con motivo; el reporte responde `200` |
| Alta y cambio de fuente | Llegan a audit-service como `insert` y `update` con su correlación |

## Manifiesto de despliegue (para integración)

Lo que pide la guía del Parcial 3 para integrar el servicio en Compose, proxy y staging.

| Concepto | Valor |
|---|---|
| Servicio | `data-governance-service` |
| Puerto interno | `3119` |
| Imagen | `services/data-governance-service/Dockerfile` (`python:3.12-slim`, sin cambios a la estructura de la plantilla); ~64 MB |
| Código probado | commit `666d38e` (rama `feature/data-governance-service`); imagen local `sha256:4d19f90c7261…` |
| Ruta de salud | `GET /v1/health` → `200` siempre; `status: degraded` si Postgres o Redis fallan |
| Prefijo en el proxy | `/api/data-governance-service/v1/*` (convención del Caddyfile de staging) |
| **Migración** | `db/migraciones/sprint4_data_governance.sql`: idempotente, la corre `infra/migrar-postgres.sh`. Crea `fuentes_datos`, `fuente_versiones`, `linaje_registros`, `linaje_insumos`, `politicas_retencion` (con llaves foráneas a `usuarios`), los triggers de "solo se anexa" y siembra 6 fuentes, 3 versiones y 6 políticas. **Correrla antes de arrancar el servicio**; falta incorporarla a `db/schema.sql` |
| Datos propios | Esas 5 tablas; ningún otro almacén |
| Dependencias obligatorias | PostgreSQL (con la migración), Redis (sesión) |
| Dependencias de lectura | transactions-ingestion-service, core-process-service, availability-service, income-segmentation-service. Si una no responde, solo su fuente o conjunto sale `disponible: false` |
| Bitácora | audit-service (opcional: sin `AUDIT_SERVICE_URL` no se envía) |
| Quién lo llama | demand-forecast-service (y, cuando lo hagan, ingestion, income-segmentation, algorithms-core y analytics-stats) con `POST /v1/lineage` |
| Comando de prueba | `python -m pytest` (ver *Probar*); humo: `curl -i <base>/v1/health` debe traer `X-Correlation-Id` |

**Variables**

| Variable | Obligatoria | Secreto | Valor local |
|---|---|---|---|
| `PORT` | sí | | `3119` |
| `SERVICE_NAME` | sí | | `data-governance-service` |
| `SERVICE_VERSION` | | | `1.0.0` |
| `XML_NAMESPACE` | sí | | `governance/v1` |
| `JWT_ACCESS_SECRET` | sí | **sí** | el mismo de auth-service |
| `REDIS_HOST`, `REDIS_PORT` | sí | | `redis`, `6379` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME` | sí | | `postgres`, `5432`, `retail_user`, `retaildb` |
| `DB_PASSWORD` | sí | **sí** | la del Postgres compartido |
| `INGESTION_SERVICE_URL` | recomendada | | `http://transactions-ingestion-service:3111` |
| `CORE_PROCESS_SERVICE_URL` | recomendada | | `http://core-process-service:3104` |
| `AVAILABILITY_SERVICE_URL` | recomendada | | `http://availability-service:3114` |
| `INCOME_SEGMENTATION_SERVICE_URL` | recomendada | | `http://income-segmentation-service:3112` |
| `AUDIT_SERVICE_URL` | recomendada | | `http://audit-service:3110` |
| `FRESHNESS_SALES_DAYS` | | | `7` (DG-8) |
| `FRESHNESS_SEGMENTS_DAYS` | | | `365` (DG-8) |

**Bloque para `infra/docker-compose.yml`** (mismo estilo que `analytics-stats`):

```yaml
  data-governance-service:
    image: python:3.12
    container_name: retail_data_governance_service
    working_dir: /app
    volumes:
      - ../services/data-governance-service:/app
    environment:
      PORT: 3119
      SERVICE_NAME: data-governance-service
      SERVICE_VERSION: 1.0.0
      XML_NAMESPACE: governance/v1
      JWT_ACCESS_SECRET: dev_access_secret_solo_para_local
      REDIS_HOST: redis
      REDIS_PORT: 6379
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: retail_user
      DB_PASSWORD: retail_pass_2026
      DB_NAME: retaildb
      INGESTION_SERVICE_URL: http://transactions-ingestion-service:3111
      CORE_PROCESS_SERVICE_URL: http://core-process-service:3104
      AVAILABILITY_SERVICE_URL: http://availability-service:3114
      INCOME_SEGMENTATION_SERVICE_URL: http://income-segmentation-service:3112
      AUDIT_SERVICE_URL: http://audit-service:3110
      FRESHNESS_SALES_DAYS: 7
      FRESHNESS_SEGMENTS_DAYS: 365
    ports:
      - "3119:3119"
    command: sh -c "pip install -r requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port 3119 --reload"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:3119/v1/health').status==200 else 1)\""]
      interval: 15s
      timeout: 5s
      retries: 10
      start_period: 60s
    networks:
      - retail_net
```

Y en demand-forecast-service, `DATA_GOVERNANCE_SERVICE_URL: http://data-governance-service:3119`
(ya está en el bloque de su README).

## Pendientes fuera de este servicio

- **Juan Ángel:** incorporar la migración a `db/schema.sql`; en ingestion, `rejectedByCode` en el lote,
  lectura del Auditor sobre los lotes, `confirmedAt` y registrar linaje al confirmar un lote.
- **Pamela:** filtro por fecha en capturas, conteos por fecha en observaciones y visitas, y registrar
  linaje en las versiones de segmento.
- **Leonardo:** registrar linaje en las corridas de algorithms-core y analytics-stats (demand-forecast
  ya lo hace).
- **Plantillas (Juan Ángel):** `GET /v1/health` en XML lleva el `xmlns` del servicio y `health.xsd`
  no declara namespace.

## Limitaciones conocidas

- El linaje depende de que cada servicio lo registre; un recurso de un servicio que aún no lo hace
  sale `registered: false` en el árbol de quien lo usó.
- La calidad de `capturas-campo` mide solo duplicados y frescura (availability no deja entrar
  capturas incompletas ni fuera de rango), y sobre todo el historial (no filtra por fecha).
- La retención se **evalúa y simula** aquí; aplicarla le toca a cada dueño, y salvo notifications
  (que ya archiva) ninguno la aplica todavía.
