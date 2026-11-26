# demand-forecast-service (3116 · T-13)

Pronóstico semanal de demanda por **producto y zona** con Holt-Winters (D-40): 8 semanas,
intervalos de 80 % y 95 %, validación con las últimas 4 semanas (MAPE) y `422` con menos de 12
semanas de historia. Las corridas se guardan en MongoDB (`forecast_runs`, D-47) con la serie que
usaron, para repetirlas (D-15).

- Contrato: [`docs/contratos/demand-forecast-service.md`](../../docs/contratos/demand-forecast-service.md)
  y su XSD (namespace `forecast/v1`); ejemplos en `docs/contratos/ejemplos/demand-forecast-*`.
- Parte de `services/template-fastapi/` (T-02: `X-Correlation-Id`, health con dependencias,
  error estándar, JSON/XML según `Accept`, sesión JWT + Redis).
- Swagger en `/docs`, con ejemplos JSON y XML de éxito y de error.

## Rutas

| Método | Ruta | Roles | Qué hace |
|---|---|---|---|
| POST | `/v1/forecast/run` | Analista comercial | Calcula y guarda una corrida (`201`) |
| POST | `/v1/forecast/runs/:id/replay` | Analista comercial | Recalcula desde la foto y compara (`200`) |
| GET | `/v1/forecast/runs` | 6 perfiles internos | Historial paginado, filtros `productId`, `zoneId` |
| GET | `/v1/forecast/runs/:id` | 6 perfiles internos | La corrida completa |
| GET | `/v1/health` | Sin auth | `mongodb` y `redis`; `postgres: no configurado` |

Proveedor e Investigador de mercado → `403` en todas.

## Cómo está armado

| Módulo | Regla | Qué hace |
|---|---|---|
| `app/semanas.py` | DF-1, DF-3 | Semanas lunes–domingo en America/Monterrey, sin la semana en curso; relleno con 0 marcado `filled`; SHA-256 de la serie |
| `app/unidades.py` | DF-2, D-06 | `cantidad × contenido × factorBase` → kg, l o pza; tipos mezclados → `422` |
| `app/publicacion.py` | DF-8, D-36, P-11 | 10 transacciones **y** 3 tiendas (`PUBLICATION_RULE=ambos`) |
| `app/modelo.py` | DF-4 a DF-7 | ETS(A,A,A) de statsmodels, periodo 4; validación sin ver las 4 reservadas; intervalos analíticos; recorte a 0 |
| `app/fuentes.py` | — | catalog-service y core-process-service por HTTP, 3 s → `503` |
| `app/corridas.py` | D-47, D-25 | `forecast_runs` en Mongo, 2 s → `503` |
| `app/avisos.py` | — | Bitácora, aviso y linaje de fondo (1.5 s), con token y correlación |
| `app/forecast_api.py` | — | Rutas, validación de entrada y permisos |

El cálculo no sabe de HTTP: `replay` usa el mismo `modelo.pronosticar` sobre la serie guardada.

## Probar

Con Python 3.12 (statsmodels 0.14.4 no tiene versión para 3.13+):

```bash
pip install -r requirements-dev.txt
python -m pytest                      # 113 pruebas; la de Mongo real se salta sin MONGO_URL_PRUEBAS
```

O sin instalar nada local, en el mismo Python del Dockerfile (desde la raíz del repo, porque las
pruebas validan contra `docs/contratos/demand-forecast-service.xsd`):

```bash
docker run --rm -v "$PWD":/repo -w /repo/services/demand-forecast-service python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest"
```

Con el Mongo del stack (base aparte que se borra al terminar, nunca `retaildb`):

```bash
MONGO_URL_PRUEBAS="mongodb://retail_admin:retail_pass_2026@localhost:27017/forecast_pruebas?authSource=admin" \
  python -m pytest tests/test_mongo_real.py
```

| Archivo | Qué prueba |
|---|---|
| `tests/test_modelo.py` | Casos de control del contrato: 11/12 semanas, patrón exacto y con ruido, reservadas en 0, recorte, determinismo |
| `tests/test_dominio.py` | Semanas en hora de Monterrey, 500 ml + 1 l = 2.5 l, tipos mezclados, D-36 con las dos reglas |
| `tests/test_fuentes.py` | 404, 503 por timeout o 5xx, reenvío de token y correlación |
| `tests/test_corridas.py` | Guardar y releer igual, índices, listado, 400/404, Mongo caído → 503 |
| `tests/test_api.py` | Las 4 rutas: permisos de los 8 roles, 400/404/409/422/503, avisos, **todo XML validado contra el XSD** |

## Medido en vivo (local, datos del generador de 10k)

Por HTTP, con usuarios del seed, catalog y core-process reales (26-nov-2026):

| Caso | Respuesta | Tiempo de cálculo (`durationMs`) |
|---|---|---|
| Azúcar en Zona Valle, 52 semanas (`D-40-patron`) | `201`, MAPE 0.000 %, pronóstico exacto (100, 93, 89, 92…) | 348 ms |
| `GEN-COC-1L`, 12 semanas | `201`, MAPE 28.9 % (8 semanas para ajustar: lo avisa `limitations`) | 120 ms |
| Frijol, todas las zonas, 52 semanas | `201`, MAPE 25.3 % | 125 ms |
| `GEN-ENE-473`, 11 semanas | `422` (D-40) | ~70 ms de petición |
| Huevo en `pza` y `kg` | `422` (DF-2) | ~70 ms de petición |
| Quinoa en Zona Oriente, 8 ventas | `201` no disponible, sin números (D-36) | ~50 ms de petición |
| `replay` del azúcar | `200`, `identical: true` | 263 ms |
| MongoDB detenido | `run` y `runs` → `503` en ~2.3 s; health `degraded` | — |

Todas las respuestas, también en XML, validaron contra el XSD. La bitácora llegó a audit-service
con el mismo `X-Correlation-Id` de la petición.

## Manifiesto de despliegue (para integración)

Lo que pide la guía del Parcial 3 para integrar el servicio en Compose, proxy y staging.

| Concepto | Valor |
|---|---|
| Servicio | `demand-forecast-service` |
| Puerto interno | `3116` |
| Imagen | `services/demand-forecast-service/Dockerfile` (`python:3.12-slim`, sin cambios a la estructura de la plantilla) |
| Código probado | commit `bc482ae` (rama `feature/demand-forecast-service`); imagen local `sha256:5f108b0c9a72…` |
| Ruta de salud | `GET /v1/health` → `200` siempre; `status: degraded` si Mongo o Redis fallan |
| Prefijo en el proxy | `/api/demand-forecast-service/v1/*` (convención del Caddyfile de staging) |
| Migraciones | **Ninguna**: no usa PostgreSQL |
| Datos propios | MongoDB, colección `forecast_runs` en la base del `MONGO_URL`; crea sus índices `userId_date` y `productId_date` al guardar la primera corrida |
| Dependencias obligatorias | Redis (sesión), MongoDB (corridas), catalog-service, core-process-service (con `GET /v1/analytics/weekly-sales`, PR #114) |
| Dependencias opcionales | audit-service, notifications-service, data-governance-service: sin su variable no se envía; si fallan, solo queda log |
| Comando de prueba | `python -m pytest` (ver *Probar*); humo: `curl -i <base>/v1/health` debe traer `X-Correlation-Id` |

**Variables**

| Variable | Obligatoria | Secreto | Valor local |
|---|---|---|---|
| `PORT` | sí | | `3116` |
| `SERVICE_NAME` | sí | | `demand-forecast-service` |
| `SERVICE_VERSION` | | | `1.0.0` |
| `XML_NAMESPACE` | sí | | `forecast/v1` |
| `JWT_ACCESS_SECRET` | sí | **sí** | el mismo de auth-service |
| `REDIS_HOST`, `REDIS_PORT` | sí | | `redis`, `6379` |
| `MONGO_URL` | sí | **sí** (lleva contraseña) | `mongodb://…@mongodb:27017/retaildb?authSource=admin` |
| `CATALOG_SERVICE_URL` | sí | | `http://catalog-service:3102` |
| `CORE_PROCESS_SERVICE_URL` | sí | | `http://core-process-service:3104` |
| `AUDIT_SERVICE_URL` | recomendada | | `http://audit-service:3110` |
| `NOTIFICATIONS_SERVICE_URL` | recomendada | | `http://notifications-service:3109` |
| `DATA_GOVERNANCE_SERVICE_URL` | cuando exista 3119 | | `http://data-governance-service:3119` |
| `SEASONAL_PERIOD` | | | `4` (DF-5) |
| `PUBLICATION_RULE` | | | `ambos` (DF-8, P-11) |

**Bloque para `infra/docker-compose.yml`** (mismo estilo que `analytics-stats`):

```yaml
  demand-forecast-service:
    image: python:3.12
    container_name: retail_demand_forecast_service
    working_dir: /app
    volumes:
      - ../services/demand-forecast-service:/app
    environment:
      PORT: 3116
      SERVICE_NAME: demand-forecast-service
      SERVICE_VERSION: 1.0.0
      XML_NAMESPACE: forecast/v1
      JWT_ACCESS_SECRET: dev_access_secret_solo_para_local
      REDIS_HOST: redis
      REDIS_PORT: 6379
      MONGO_URL: mongodb://retail_admin:retail_pass_2026@mongodb:27017/retaildb?authSource=admin
      CATALOG_SERVICE_URL: http://catalog-service:3102
      CORE_PROCESS_SERVICE_URL: http://core-process-service:3104
      AUDIT_SERVICE_URL: http://audit-service:3110
      NOTIFICATIONS_SERVICE_URL: http://notifications-service:3109
      DATA_GOVERNANCE_SERVICE_URL: http://data-governance-service:3119
      SEASONAL_PERIOD: 4
      PUBLICATION_RULE: ambos
    ports:
      - "3116:3116"
    command: sh -c "pip install -r requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port 3116 --reload"
    depends_on:
      redis:
        condition: service_healthy
      mongodb:
        condition: service_started
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:3116/v1/health').status==200 else 1)\""]
      interval: 15s
      timeout: 5s
      retries: 10
      start_period: 90s
    networks:
      - retail_net
```

## Pendientes fuera de este servicio

- **catalog-service (Pamela):** `GET /v1/products/:id/presentations?includeInactive=true`. Mientras no
  exista, las ventas de una presentación dada de baja salen en `excludedPresentations` con motivo.
- **data-governance-service (3119):** el linaje se envía con el formato de su contrato en cuanto
  exista `DATA_GOVERNANCE_SERVICE_URL`.
- **Matriz §4 (Juan Ángel):** incorporar P-11 (DF-8, `ambos`).
- **Plantillas (Juan Ángel):** `GET /v1/health` en XML lleva el `xmlns` del servicio y `health.xsd`
  no declara namespace; se resuelve en la plantilla para todos los servicios.

## Limitaciones conocidas

- Estacionalidad de 4 semanas; la anual necesitaría 108 semanas de historia.
- Con 12 semanas, la validación ajusta 9 parámetros con 8 datos: el pronóstico es frágil y lo dice
  `limitations`.
- Una semana rellenada con 0 que fue falta de captura (no de demanda) baja la estacionalidad de esa
  posición del ciclo; por eso se marca con `filled`.
- Es una proyección de demanda agregada de la zona; no explica causas ni describe personas (RN-02).
