# basket-analysis-service (3113 · T-12)

Canasta típica de un grupo **zona + segmento** (D-37: productos en al menos el 20 % de las
canastas), comparación entre dos periodos, evolución semanal o mensual y mezcla del gasto por
categoría. Cada resultado respeta D-36: no se publica con menos de 10 transacciones y 3 tiendas.

- Contrato: [`docs/contratos/basket-analysis-service.md`](../../docs/contratos/basket-analysis-service.md)
  y su XSD (namespace `basket-analysis/v1`); ejemplos en `docs/contratos/ejemplos/basket-analysis-*`.
- Parte de `services/template-fastapi/` (T-02: `X-Correlation-Id`, health con dependencias,
  error estándar, JSON/XML según `Accept`, sesión JWT + Redis).
- Swagger en `/docs`, con ejemplos JSON y XML de éxito y de error.
- **No guarda nada**: calcula al vuelo con lecturas HTTP. Sin PostgreSQL ni MongoDB; Redis solo
  para la sesión. La reproducibilidad (D-15) es por instantánea: mismo `asOf`, mismo resultado y
  mismo `dataVersion.sha256`.

## Rutas

Todas son consultas de los **6 perfiles internos** (Matriz §3.2, lectura de M07). Proveedor e
Investigador de mercado → `403`. `zoneId` y `segmentId` son obligatorios en todas; cualquier
parámetro desconocido → `400`.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/v1/typical-basket` | Canasta típica del grupo; `includeAll=true` también lista los que no alcanzan el 20 % |
| GET | `/v1/typical-basket/compare` | Mismo grupo en dos periodos: qué entra, qué sale y qué sigue |
| GET | `/v1/basket-evolution` | Serie por semana o mes (máx. 104 semanas o 36 meses), cada periodo con su D-36 |
| GET | `/v1/category-mix` | Gasto por categoría (`spend-by-category` de core-process) con D-36 |
| GET | `/v1/health` | Sin auth; `redis` (`postgres` y `mongodb`: `no configurado`) |

## Cómo está armado

| Módulo | Regla | Qué hace |
|---|---|---|
| `app/tipica.py` | BA-2/3/4/7 | Típico si `canastas con el producto × 5 ≥ canastas` (enteros); frecuencia, gasto promedio, resumen, orden estable, SHA-256 |
| `app/publicacion.py` | BA-5, D-36, P-11 | 10 transacciones **y** 3 tiendas (`PUBLICATION_RULE=ambos`); grupo vacío → `200` con motivo |
| `app/comparacion.py` | — | `entering`, `leaving`, `staying` e indicadores con su cambio |
| `app/periodos.py` | BA-6, D-35 | Semanas y meses en hora de Monterrey con bordes parciales; versiones del segmento en el periodo |
| `app/fuentes.py` | — | core-process, catalog e income-segmentation por HTTP, 3 s → `503` |
| `app/basket_api.py` | BA-1, BA-8 | Rutas, validación y la misma instantánea `asOf` en todas las lecturas de una respuesta |

Decisiones del dominio tomadas al implementar (dentro del contrato):

- **`basketsPerWeek` sin fechas:** el periodo va de la primera a la última semana con canastas del
  grupo (una lectura semanal extra, en la misma instantánea) y se dice en `assumptions`.
- **Cobertura de `category-mix`:** `spend-by-category` no trae tiendas; la cobertura de D-36 sale de
  `basket-products`.

## Probar

```bash
pip install -r requirements-dev.txt
python -m pytest                      # 104 pruebas
```

O sin instalar nada local, en el mismo Python del Dockerfile (desde la raíz del repo, porque las
pruebas validan contra `docs/contratos/basket-analysis-service.xsd`):

```bash
docker run --rm -v "$PWD":/repo -w /repo/services/basket-analysis-service python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest"
```

| Archivo | Qué prueba |
|---|---|
| `tests/test_dominio.py` | Casos de control: 20/19 de 100, 3/2 de 12, D-36 con las dos reglas y sus motivos, orden, comparación, periodos y topes, versiones (D-35), huella |
| `tests/test_fuentes.py` | 404 de zona y segmento, 503 por timeout o 5xx, reenvío de token y correlación, historial paginado |
| `tests/test_api.py` | Las 4 rutas: 13 consultas inválidas → `400`, permisos de los 8 roles, D-36 sin números, **todo XML validado contra el XSD** |

## Medido en vivo (local, datos del generador de 10k)

Por HTTP, con usuarios del seed y core-process, catalog e income-segmentation reales (26-nov-2026):

| Caso | Respuesta | Tiempo |
|---|---|---|
| `D-37-frontera`: Zona Centro, oct-2026, 300 canastas en 4 tiendas | Café soluble 60/300 = 0.20 **típico**; Avena 57/300 = 0.19 **no típico** | 135 ms |
| Mismos filtros en core-process | Ticket 244.23 y 3.89 productos por canasta: **iguales** | — |
| Repetir con el mismo `asOf` | Mismo cuerpo y mismo SHA-256 | — |
| `D-36-zona-chica`: Zona Norte | No disponible: 9 transacciones y 2 tiendas | 68 ms |
| Sin fechas | 62.67 canastas por semana | 181 ms |
| `compare` septiembre vs octubre | Entran Arroz blanco y Café soluble; siguen 4 | 73 ms |
| `basket-evolution` mensual, 15-jun a 22-nov | 6 meses sin huecos, junio parcial | 68 ms |
| `category-mix`, octubre | Abarrotes 50.35 %, Lácteos 13.86 %… | 74 ms |

Todas las respuestas, también en XML, validaron contra el XSD.

## Manifiesto de despliegue (para integración)

Lo que pide la guía del Parcial 3 para integrar el servicio en Compose, proxy y staging.

| Concepto | Valor |
|---|---|
| Servicio | `basket-analysis-service` |
| Puerto interno | `3113` |
| Imagen | `services/basket-analysis-service/Dockerfile` (`python:3.12-slim`, sin cambios a la estructura de la plantilla); ~60 MB |
| Código probado | commit `c80dbb8` (rama `feature/basket-analysis-service`); imagen local `sha256:5ceebed55e75…` |
| Ruta de salud | `GET /v1/health` → `200` siempre; `status: degraded` si Redis falla |
| Prefijo en el proxy | `/api/basket-analysis-service/v1/*` (convención del Caddyfile de staging) |
| Migraciones | **Ninguna**: no usa PostgreSQL |
| Datos propios | **Ninguno**: no guarda resultados (no usa MongoDB) |
| Dependencias obligatorias | Redis (sesión); core-process-service (con `GET /v1/analytics/basket-products`, PR #114); catalog-service; income-segmentation-service |
| Bitácora, aviso, linaje | Ninguno: todas las rutas son consultas (contrato) |
| Comando de prueba | `python -m pytest` (ver *Probar*); humo: `curl -i <base>/v1/health` debe traer `X-Correlation-Id` |

**Variables**

| Variable | Obligatoria | Secreto | Valor local |
|---|---|---|---|
| `PORT` | sí | | `3113` |
| `SERVICE_NAME` | sí | | `basket-analysis-service` |
| `SERVICE_VERSION` | | | `1.0.0` |
| `XML_NAMESPACE` | sí | | `basket-analysis/v1` |
| `JWT_ACCESS_SECRET` | sí | **sí** | el mismo de auth-service |
| `REDIS_HOST`, `REDIS_PORT` | sí | | `redis`, `6379` |
| `CORE_PROCESS_SERVICE_URL` | sí | | `http://core-process-service:3104` |
| `CATALOG_SERVICE_URL` | sí | | `http://catalog-service:3102` |
| `INCOME_SEGMENTATION_SERVICE_URL` | sí | | `http://income-segmentation-service:3112` |
| `PUBLICATION_RULE` | | | `ambos` (BA-5, P-11) |

**Bloque para `infra/docker-compose.yml`** (mismo estilo que `analytics-stats`):

```yaml
  basket-analysis-service:
    image: python:3.12
    container_name: retail_basket_analysis_service
    working_dir: /app
    volumes:
      - ../services/basket-analysis-service:/app
    environment:
      PORT: 3113
      SERVICE_NAME: basket-analysis-service
      SERVICE_VERSION: 1.0.0
      XML_NAMESPACE: basket-analysis/v1
      JWT_ACCESS_SECRET: dev_access_secret_solo_para_local
      REDIS_HOST: redis
      REDIS_PORT: 6379
      CORE_PROCESS_SERVICE_URL: http://core-process-service:3104
      CATALOG_SERVICE_URL: http://catalog-service:3102
      INCOME_SEGMENTATION_SERVICE_URL: http://income-segmentation-service:3112
      PUBLICATION_RULE: ambos
    ports:
      - "3113:3113"
    command: sh -c "pip install -r requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port 3113 --reload"
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:3113/v1/health').status==200 else 1)\""]
      interval: 15s
      timeout: 5s
      retries: 10
      start_period: 60s
    networks:
      - retail_net
```

## Pendientes fuera de este servicio

- **Plantillas (Juan Ángel):** `GET /v1/health` en XML lleva el `xmlns` del servicio y `health.xsd`
  no declara namespace; se resuelve en la plantilla para todos los servicios.

## Limitaciones conocidas

- Con el seed solo (una tienda por zona) ningún grupo se publica con `ambos`: hacen falta los datos
  del generador (`db/README-generador.md`), con 4 tiendas por zona normal.
- La canasta típica dice qué productos son frecuentes en el grupo; no dice que se compren juntos
  (eso es asociación, algorithms-core) ni por qué.
- `category-mix` no acepta `asOf`: core-process no lo ofrece en `spend-by-category`.
- Describe al grupo agregado de la zona; nunca a una persona (RN-02).
