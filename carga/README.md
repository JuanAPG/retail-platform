# Pruebas de carga y mediciones del Parcial 3 (`carga/`)

Locust con **usuarios distintos por sesión y roles reales** contra los **20 microservicios**, más las
herramientas para medir lo que pide la guía: tiempos por servicio y por etapa, CPU/RAM/disco, planes
de consulta e índices, y la caída completa de Redis con su 503 controlado.

Antes de medir hay que cargar los datos del generador (`db/README-generador.md`): sin volumen, las
consultas pesadas no miden nada.

| Archivo | Qué hace |
|---|---|
| `usuarios_carga.py` | Crea por la API de auth-service las cuentas sintéticas `carga.<perfil>.NN@retail-carga.test` (idempotente). |
| `sesiones.py` | Abre sus sesiones **antes** de la prueba, a 14 logins por minuto (el límite es 15 por IP), y las guarda en `.sesiones.json`. |
| `preparar.py` | Lee del ambiente los ids que usan las tareas y deja una recomendación aceptada para las asignaciones → `.fixtures.json`. |
| `escenario.py` | Qué hace cada perfil: rutas, pesos, cuerpos de las escrituras, forma de la carga y **validación de negocio**. Sin Locust ni red. |
| `locustfile.py` | Los 5 perfiles, la forma 5 → 10 → 25 → 50 → pico 60 → 10 y la renovación de tokens. |
| `medir/resumen.py` | De los CSV de Locust a una tabla por servicio y por etapa (fallas HTTP, de negocio y 429 por separado). |
| `medir/recursos.py` | `docker stats` cada N segundos durante la prueba, y el tamaño de Postgres y de Mongo. |
| `medir/planes.py` | `EXPLAIN (ANALYZE, BUFFERS)` de las consultas pesadas reales, uso de índices y `explain` de Mongo. |
| `medir/redis_caido.py` | Detiene Redis y verifica 503 controlado y recuperación en cada servicio (**solo local**). |
| `tests/` | 52 pruebas sin red: `python -m unittest discover -s carga/tests -v`. |

`.sesiones.json` y `.fixtures.json` llevan tokens e ids del ambiente: están en `.gitignore`, igual que
`carga/resultados/`.

## Requisitos

- Python 3.10+ con `pip install locust` (probado con Locust 2.47). El resto es biblioteca estándar.
- `medir/recursos.py`, `planes.py` y `redis_caido.py` usan `docker`: corren **en el host de los
  contenedores** (tu equipo, o la VM de staging por SSH).
- Contraseñas por variable de entorno, nunca en el repo:

| Variable | Para qué |
|---|---|
| `CARGA_ADMIN_PASSWORD` | Administrador que crea las cuentas de carga |
| `CARGA_PASSWORD` | Contraseña de las cuentas de carga (8+ caracteres, mayúscula, minúscula y número) |
| `CARGA_SEED_PASSWORD` | Usuarios del seed que usa `preparar.py` (Analista, Planeador, Gerente) |

## Cómo correrla

Sin `--base`, todo va a local (`http://localhost:<puerto>` de `infra/docker-compose.yml`). Con
`--base https://<host>`, a `https://<host>/api/<servicio>`, las rutas del proxy de staging
(`infra/staging/routes.caddy`).

```bash
export CARGA_ADMIN_PASSWORD=... CARGA_PASSWORD=... CARGA_SEED_PASSWORD=...
BASE=https://34.51.89.203            # staging; quítalo para local

python carga/usuarios_carga.py --por-perfil 12 --base $BASE      # 60 cuentas, una vez por ambiente
python carga/sesiones.py --por-perfil 12 --base $BASE            # ~4.5 min (14 logins/min)
python carga/preparar.py --base $BASE

mkdir -p carga/resultados
python carga/medir/recursos.py carga/resultados/stg-100k --duracion 800 &   # en la VM, en paralelo
locust -f carga/locustfile.py --headless --csv carga/resultados/stg-100k --csv-full-history --corrida stg-100k
python carga/medir/resumen.py carga/resultados/stg-100k --ambiente staging
python carga/medir/planes.py carga/resultados/stg-100k --volumen 100k --ambiente staging   # después, no durante
```

El destino de Locust sale de `.sesiones.json`: las sesiones se abrieron contra ese ambiente.

| Opción de Locust | Para qué |
|---|---|
| `--corrida <nombre>` | Va en cada `X-Correlation-Id` (`carga-<corrida>-…`) para encontrar la corrida en los logs y en auditoría. |
| `--escala 0.2 --escala-tiempo 0.1` | Humo: de 1 a 12 usuarios en ~80 s. |
| `--solo-lectura` | Sin escrituras. |
| `--saltar-caidos` | **Solo humo local:** no manda tareas a los servicios que no responden al arrancar (ver Limitaciones). |
| `Catalogo Investigador …` | Al final, corre solo esas clases de usuario. |

Las sesiones se renuevan con `/v1/auth/refresh` antes de que venza el access token (15 min). El
refresh **rota** el refresh token: al terminar, Locust reescribe `.sesiones.json` con los nuevos, así
que la siguiente corrida no necesita volver a hacer login. Si pasaron días, vuelve a correr
`sesiones.py`.

## Qué hace cada perfil

| Perfil (rol real) | Lecturas | Escrituras |
|---|---|---|
| catálogo (Responsable de precios) | productos, presentaciones, precio vigente, comparación entre zonas, elasticidad vigente | aprueba las promociones que propuso el Gerente |
| investigador (Investigador de mercado) | tiendas, productos, zonas | lotes de sincronización de 5 capturas (disponibilidad y precio observado); **propiedad**: pide su lote (200) y el de otro investigador (404) |
| analista (Analista comercial) | canasta típica, mezcla por categoría, cobertura de básicos, transacciones, corridas de pronóstico, clasificación de zonas, clustering, reporte de calidad, importación inexistente (404) | corre un pronóstico |
| gerente (Gerente de categoría) | accesibilidad, recomendaciones, reportes, promociones | propone promociones; asigna el seguimiento de una recomendación aprobada |
| administrador (Administrador) | monitoreo, auditoría, usuarios, notificaciones, fuentes y linaje de datos | — |

- **Los 20 servicios reciben carga** (lo prueba `tests/test_escenario.py`).
- **Ids variables bajo un mismo nombre:** las rutas se agrupan por plantilla (`/v1/products/:id/presentations`),
  no por id, para que las estadísticas se puedan leer.
- **XML:** 20 % de las lecturas piden `Accept: application/xml`, como el escritorio (D-31). La fila
  sale con `[xml]`.

**Cómo se evita ensuciar los datos de la demo** (los controles de `db/README-generador.md`):

- La **disponibilidad** de los lotes va fechada **hace 30 días**. availability-service ya tiene un dato
  más reciente del cargador, así que la guarda como `conflicto` (D-42) y la cobertura de control no
  cambia (77.78 % y 88.89 %). El precio observado entra pendiente de aprobación.
- Las promociones llevan nombre `carga-<corrida>-…` y D-39 no anexa nada a `precios`.
- La asignación se repite sobre la misma recomendación y el mismo responsable: el contrato la trata
  como **reintento** (`200`, no crea otra).
- Lo que sí queda en la base: promociones, lotes y capturas de sync, y corridas de pronóstico (unos
  cientos de registros por corrida, reconocibles por `carga-`/el dispositivo). No hay ruta para borrarlos.

## Qué cuenta como falla

Además del código HTTP, se valida la **respuesta de negocio** (`escenario.py`, sección "validación de
negocio"). Hay tres categorías:

| Categoría | Cuándo | Dónde se ve |
|---|---|---|
| Falla HTTP | Código distinto al esperado de esa ruta (incluye 401, 5xx y conexión rechazada). | `*_failures.csv` |
| Falla **NEGOCIO** | Código correcto y cuerpo incorrecto. | `*_failures.csv`, con el prefijo `NEGOCIO:` |
| **LIMITADO** | 429 (límite de login u otro): no es falla, se cuenta aparte. | Fila de tipo `LIMITADO` |

Qué revisa NEGOCIO:

- **Acuse de sync:** mismo lote, un resultado por captura en su orden, `summary.total` correcto y cada
  captura `aceptada` o `conflicto`; una `rechazada` o `duplicada` es falla.
- **Propiedad:** lote propio → 200 con ese `batchId`; ajeno → 404 `NOT_FOUND`.
- **Promoción:** al crear, `pendiente` con lo enviado; al aprobar, `aprobada` con `resolvedBy`.
- **Asignación:** misma recomendación y responsable, estado válido del seguimiento.
- **Pronóstico:** 201 con `id`, o 422 con el error estándar (menos de 12 semanas o unidades mezcladas,
  D-40 y DF-2).
- **D-20:** cobertura, canasta y mezcla con `disponible:false` traen `motivo` y **no** traen valor
  (un 0 es falla).
- **Accesibilidad** de la zona pedida, **listados** con `data` y `total` coherentes, **XML** bien
  formado y sin `<error>`. La validación XSD de cada servicio va aparte (`scripts/validate-xml.sh`).

## Forma de la carga

| Etapa | Usuarios | Duración | Ritmo de entrada |
|---|---|---|---|
| calentamiento | 5 | 1 min | 1/s |
| baja | 10 | 2 min | 1/s |
| media | 25 | 3 min | 2/s |
| alta | 50 | 4 min | 2/s |
| pico | 60 | 1 min | 10/s |
| recuperación | 10 | 2 min | 5/s |

13 min en total. Locust reparte por igual entre los 5 perfiles: el pico necesita **12 sesiones por
perfil** (`sesiones.py --por-perfil 12`). Si faltan, los usuarios extra quedan inactivos y se avisa.

## Mediciones

| Qué pide la guía | Herramienta | Estado |
|---|---|---|
| Tiempos por servicio y por etapa, errores, 429 aparte | `locust` + `medir/resumen.py` | Listo; corrida real en staging pendiente de los datos |
| CPU, RAM y disco | `medir/recursos.py` (en la VM) | Listo |
| Planes de consulta e índices en PostgreSQL y Mongo | `medir/planes.py` | Listo (10k local abajo) |
| Caída completa de Redis y su 503 controlado | `medir/redis_caido.py` | Listo **en local**; en staging, Juan Ángel en una ventana acordada (`infra/staging/pruebas-de-fallos.md`) |
| Caché activa contra omitida, con la sesión vigente | — | **Pendiente con Pamela**: catalog-service cachea en Redis categorías, unidades, municipios y códigos postales (`catalog:*`, TTL 1 h) sin forma de apagarlo. Hay que acordar el control. |

### Resultados locales (no son la medición de nube)

Equipo de desarrollo (Windows 11, Docker Desktop con 8 GB), 10k ventas del generador 1.3.0. Los 20
servicios no caben juntos en 8 GB: se midió por rondas. **Estos números solo prueban que la suite
funciona**; la medición que se presenta es la de staging.

| Corrida | Usuarios | Peticiones | Fallas HTTP | Fallas negocio | p95 |
|---|---|---|---|---|---|
| Humo ronda A (catálogo, investigador, analista, gerente; 14 servicios) | 1–12 | 235 | 0 | 0 | 140 ms |
| Humo ronda B (administrador, analista, gerente; 12 servicios) | 1–12 | 216 | 0 | 0 | 88 ms |

**Redis caído (local):** 14/14 servicios arriba respondieron `503 SERVICE_UNAVAILABLE` en 0.1–2.1 s,
el login también dio 503, y todos se recuperaron solos en ≤ 2 s al volver Redis (las sesiones
sobreviven: Redis guarda RDB en su volumen). La primera corrida encontró que basket-analysis y
demand-forecast respondían **500**; se corrigió en `fix/fastapi-redis-503`.

**Planes (10k):**

| Consulta | ms | Observación |
|---|---|---|
| Elasticidad semanal de todas las presentaciones (algorithms-core) | 112 | Recorre completas `transacciones_detalle` y `canastas`: agrega todo, es lo esperado. Vigilarla en 500k. |
| Elasticidad de una presentación | 7 | Usa `idx_detalle_presentacion`. |
| Canastas para Apriori, zona + segmento + un mes | 61 | Usa `idx_canastas_fecha` y no `idx_canastas_zona_fecha`, y recorre `transacciones` entera solo por un filtro de tienda que no se usa: mejora posible en algorithms-core. |
| Transacciones recientes (core-process) | 0.4 | `idx_transacciones_fecha`. |
| Cobertura de una zona (availability) | 32 | `idx_tiendas_zona` + llave única de `inventario`. |
| Mongo: corridas, lotes, capturas, sondeos, notificaciones | ≤ 2 | Todas con índice; ninguna COLLSCAN. |

## Limitaciones conocidas

- **Windows y puertos cerrados:** cada intento contra un servicio apagado tarda segundos y traba el
  ciclo de gevent de Locust, ensuciando los tiempos de todos (se vieron respuestas de 10 s en
  servicios que contestaban en 60 ms). En local, usa `--saltar-caidos`. En staging no se usa: ahí un
  servicio caído es una falla que hay que medir.
- **`/v1/health` no se publica en staging** (`routes.caddy`, `@interno`): Locust revisa el estado con
  `GET /v1/monitoring/services` y una sesión de administrador.
- **Un solo proceso:** la cola de promociones por aprobar y el registro de lotes para la propiedad viven
  en memoria. En modo distribuido (`--master`/`--worker`) cada worker tendría los suyos.
- **El p95 por servicio** del resumen es el de su ruta más lenta: Locust da percentiles por ruta, no por
  grupo de rutas.
