# analytics-stats

Estadística de la plataforma: pruebas de hipótesis (RF-20), ANOVA (RF-21),
comparación de proporciones (RF-22) y clustering de zonas (RF-16). Python + FastAPI
con scipy, statsmodels y scikit-learn. Puerto **3106**.
Contrato: [`docs/contratos/analytics-stats.md`](../../docs/contratos/analytics-stats.md) y `.xsd` (namespace `stats/v1`).

Parte de `template-fastapi` (health, error estándar, logging, XML por `Accept`,
sesión JWT + Redis con `sesion_actual`); eso no se modifica. Aquí van los módulos de negocio.

## Rutas

| Método | Ruta | Roles (D-24) | Qué hace |
|---|---|---|---|
| POST | `/v1/hypothesis/test` | Analista comercial | Welch (o Mann-Whitney si algún grupo tiene menos de 8 valores) entre dos grupos |
| POST | `/v1/anova` | Analista comercial | ANOVA de un factor; con dos grupos, la prueba de dos grupos |
| POST | `/v1/proportions/compare` | Analista comercial | z de dos proporciones, Fisher si algún esperado es menor a 5, χ² con 3 o más |
| POST | `/v1/clustering/run` | Analista comercial | KMeans sobre los indicadores de zona; guarda la corrida en Mongo |
| GET | `/v1/clustering/runs`, `/v1/clustering/runs/:id` | Los 6 perfiles internos | Corridas guardadas |
| GET | `/v1/health` | — | Redis y MongoDB (`degraded` si alguno falla; siempre 200) |

Las pruebas se calculan al vuelo y **no se guardan**. Sus datos llegan en el cuerpo
(`groups`) o se leen de las canastas de core-process (`baskets`, p. ej. ticket por
segmento). La conclusión siempre habla de una diferencia en estos datos, nunca de una causa.

## Levantarlo

```bash
docker compose -f infra/docker-compose.yml up -d redis mongodb auth-service catalog-service core-process-service analytics-stats
curl localhost:3106/v1/health
```

- La primera vez tarda ~2–3 min: el contenedor instala scipy, statsmodels y scikit-learn.
  Si pip falla con "THESE PACKAGES DO NOT MATCH THE HASHES" (descarga cortada), basta con
  `docker start retail_analytics_stats`.
- En Windows el contenedor **no recarga solo** al editar el código: después de cambiar
  algo, `docker restart retail_analytics_stats`.

Sin Docker: `pip install -r requirements.txt`, copiar `.env.example` a `.env` y
`uvicorn app.main:app --port 3106` (Python 3.12).

## Swagger

`http://localhost:3106/docs`. Cada ruta trae ejemplo de respuesta en **JSON y XML**
(el XML se genera con el mismo `serializar_xml` del middleware), sus errores
estándar, y ejemplos del cuerpo en los dos modos (`groups` y `baskets`). Para probar:
**Authorize** con el `accessToken` de `POST http://localhost:3101/v1/auth/login`
(ejecutar: `analista@retail.mx`; leer corridas: cualquier perfil interno).

## Pruebas

```bash
cd services/analytics-stats
pip install -r requirements-dev.txt     # Python 3.12
python -m pytest                        # desde el repo completo: valida contra el XSD
```

Las corre el CI (`.github/workflows/ci.yml`). Lo que cubren:

- `tests/test_estadistica.py`: cada prueba contra scipy y statsmodels a **1e-9**
  (≥ 3 conjuntos), dos referencias publicadas (ANOVA de mejillones de la documentación
  de `scipy.stats.f_oneway`; el té de Fisher, p = 17/35), Welch y z contra su fórmula,
  y los casos de control de QA.
- `tests/test_api.py`: roles (D-24), 401, 400 en JSON y XML, `NaN` → 400 y no 500, y el
  XML de cada ruta y de Swagger contra el XSD.
- `tests/test_fuentes.py`: modo `baskets` con core-process y catalog simulados
  (`httpx.MockTransport`): páginas, filtros, token, tope de 500 páginas (D-27), 503 y 404.
- `tests/test_clustering.py`: partición, inercia y silueta iguales a scikit-learn,
  numeración estable, reproducible desde la entrada guardada (D-15), faltantes y
  límites de k (D-27).
- `tests/test_clustering_api.py`: correr → guardar → releer igual, listado, roles,
  Mongo caído → 503 (pymongo de verdad contra un puerto cerrado), XML.
- `tests/test_reportes.py`: bitácora y aviso de fondo, con el token del usuario; si
  audit o notifications fallan, la respuesta no cambia.
- `tests/test_mongo_real.py`: el repositorio contra un MongoDB de verdad. Se salta sin
  `MONGO_URL_PRUEBAS`; usa una base aparte y la borra:

  ```bash
  MONGO_URL_PRUEBAS="mongodb://retail_admin:retail_pass_2026@localhost:27017/analytics_pruebas?authSource=admin" \
    python -m pytest tests/test_mongo_real.py
  ```

## Datos

- **No lee tablas de otros servicios.** Pide por HTTP, reenviando el `Authorization`
  del usuario (`app/fuentes.py`): canastas y ticket promedio a core-process; zonas,
  indicadores y nombres a catalog. Si no responden en 3 s → 503.
- **Corridas de clustering en MongoDB** (D3), colección `analysis_runs`: la corrida
  completa con su entrada (la foto de D-15), solo el `userId` (D-26) e índice
  `{userId: 1, date: -1}`. Mongo caído → 503 en ~2 s (D-25). No escribe en PostgreSQL.
  La colección la comparte con algorithms-core (`type: "asociacion"`); aquí solo se toca
  `type: "clustering"`.
- **Límites del Parcial 2 (D-27):** con las 3 zonas sembradas, el clustering solo
  admite `k = 2`; el modo `baskets` lee como máximo 500 páginas por prueba (más → 400,
  no se corta).
- **Bitácora y aviso (STA-04):** cada análisis deja `ejecutar_corrida` en audit-service;
  el clustering además avisa `corrida.terminada` a quien lo corrió. Se envían de fondo
  después de responder, con límite de 1.5 s; si fallan, solo queda en el log.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `PORT`, `SERVICE_NAME`, `XML_NAMESPACE` (`stats/v1`) | Servidor y raíz XML |
| `JWT_ACCESS_SECRET`, `REDIS_HOST`, `REDIS_PORT` | Sesión (igual que los otros 9) |
| `CORE_PROCESS_SERVICE_URL`, `CATALOG_SERVICE_URL` | Modo `baskets` y clustering |
| `MONGO_URL` | Corridas de clustering (con la base en la URL) |
| `AUDIT_SERVICE_URL`, `NOTIFICATIONS_SERVICE_URL` | Bitácora y aviso; sin ellas no se reporta |

## Código

| Archivo | Qué hay |
|---|---|
| `app/estadistica.py`, `app/clustering.py` | El cálculo, como funciones puras (sin HTTP ni Mongo) |
| `app/estadistica_api.py`, `app/clustering_api.py` | Rutas: validan, piden los datos, calculan y reportan |
| `app/esquemas.py` | Cuerpos de las peticiones (pydantic) |
| `app/fuentes.py` | Llamadas a core-process y catalog |
| `app/corridas.py` | Repositorio de corridas en Mongo |
| `app/reportes.py` | Bitácora y aviso |
| `app/roles.py` | `ROL` (copia de `roles.ts`) y `requiere_roles` |
| `app/ejemplos.py` | Ejemplos de Swagger en JSON y XML |
