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
| Tiempos por servicio y por etapa, errores, 429 aparte | `locust` + `medir/resumen.py` | **Medido en staging con 10k** (abajo), sin el perfil investigador |
| CPU, RAM y disco | `medir/recursos.py` (en la VM) | Listo; en staging falta correrlo **en la VM** junto a Locust |
| Planes de consulta e índices en PostgreSQL y Mongo | `medir/planes.py` | Listo (10k local abajo); en staging se corre en la VM |
| Caída completa de Redis y su 503 controlado | `medir/redis_caido.py` | Listo **en local**; en staging, Juan Ángel en una ventana acordada (`infra/staging/pruebas-de-fallos.md`) |
| Caché activa contra omitida, con la sesión vigente | `CATALOG_CACHE` en catalog-service | Listo para medir: catalog-service cachea en Redis categorías, unidades, municipios y códigos postales (`catalog:*`, TTL 1 h). Con `CATALOG_CACHE=off` va directo a Postgres sin leer ni escribir Redis (mismas respuestas). Corrida A con la variable en `on` (valor por defecto), corrida B con `CATALOG_CACHE=off docker compose -f infra/docker-compose.yml up -d catalog-service`; la sesión se sigue validando en Redis en ambas. |

### Staging, 27 de noviembre de 2026 (10k ventas)

**Condiciones.** SHA `309d381` en los 20 servicios (con el arreglo de Redis, #163). Datos: generador
1.3.0 con 10,000 ventas más las 179 del seed, cargados y verificados por la API (totales iguales a los
CSV, cobertura de control 77.78 % y 88.89 %). VM de 2 vCPU y 7.5 GiB
(`docs/evidencia-rendimiento-staging.md`). Corrida `stg-10k` de 05:35 a 05:48 UTC con la forma
completa y **4 perfiles** (catálogo, analista, gerente, administrador): staging no tiene el rol
Investigador de mercado, así que los lotes de sync y la propiedad no se midieron. 15 sesiones por
perfil, 60 usuarios en el pico.

**Locust corrió desde un equipo del equipo, por internet**, no desde la VM: los tiempos incluyen la red
y la inspección HTTPS del antivirus de ese equipo (ver Limitaciones). Son una cota superior de lo que
ve un cliente; los de la VM (`docs/evidencia-rendimiento-staging.md`) no tienen esa capa.

| Total | |
|---|---|
| Peticiones | 10,061 en 13 min (12.9 por segundo en promedio) |
| Fallas HTTP | 13 (0.13 %): todas `503 SERVICE_UNAVAILABLE` controlados (ver abajo) |
| Fallas de negocio | 0 reales. Hubo 17 falsos positivos del validador (el 404 esperado en XML se marcaba como error); corregido después de la corrida |
| 429 | 0 |
| p50 / p95 / p99 | 94 / 640 / 2,300 ms |

| Etapa | Usuarios | Peticiones/s | p95 (mediana por segundo) | p95 peor segundo |
|---|---|---|---|---|
| calentamiento | 5 | 2.2 | 260 ms | 480 ms |
| baja | 10 | 4.5 | 250 ms | 640 ms |
| media | 25 | 11.3 | 320 ms | 650 ms |
| alta | 50 | 21.3 | 550 ms | 11 s |
| pico | 60 | 25.5 | 1,400 ms | 3.4 s |
| recuperación | 10 | 5.6 | 290 ms | 20 s |

| Ruta | Peticiones | p50 | p95 | Comentario |
|---|---|---|---|---|
| core-process `/v1/transactions` | 189 | 200 ms | 1,600 ms | La más lenta de las lecturas propias |
| basket-analysis `/v1/typical-basket` | 294 | 540 ms | 3,600 ms | Lee canastas de core-process por HTTP |
| demand-forecast `POST /v1/forecast/run` | 138 | 550 ms | 3,900 ms | Lee ventas semanales de core-process y ajusta Holt-Winters |
| promotion `POST /v1/promotions` | 398 | 150 ms | 510 ms | Valida contra catalog y pricing por HTTP |
| promotion `PATCH …/approve` | 278 | 96 ms | 300 ms | |
| workflow `POST /v1/workflow/assignments` | 190 | 130 ms | 370 ms | Reintento idempotente, verifica la recomendación en decision |
| auth `POST /v1/auth/refresh` | 55 | 360 ms | 1,800 ms | Llegan en ráfaga: las sesiones se abrieron juntas |
| documents, notifications, monitoring, income-segmentation, decision | — | ≤ 100 ms | 120–180 ms | Sin presión |

**Hallazgos.**

1. **core-process es el cuello de botella.** Su listado de transacciones llega a p95 de 1.6 s, y los
   que leen de él por HTTP con tope de 3 s se caen en cascada: las **13 fallas** son
   `503 "core-process-service no respondió en 3 s"` de basket-analysis (12) y demand-forecast (1), en las
   etapas alta y pico. El 503 es el comportamiento acordado (D-25: dependencia caída, respuesta
   controlada), pero marca el límite: con 50–60 usuarios simultáneos core-process ya no contesta a tiempo.
2. **Saturación entre 50 y 60 usuarios.** Pasar de 50 a 60 usuarios subió el rendimiento solo de 21.3 a
   25.5 peticiones/s, mientras el p95 típico pasó de 550 a 1,400 ms. Coincide con la VM de 2 vCPU
   (Juan midió el mejor rendimiento con 5 solicitudes simultáneas y caída con 10 en un banco más
   pesado por petición).
3. **Dos pausas globales** (segundo 428–433 en la etapa alta, y 678 en el pico): todos los servicios a
   la vez dejaron de responder 6–20 s (0.1–4 peticiones/s). Al afectar a todos juntos apunta a la
   infraestructura (VM, Caddy, red o el cliente) y no a un servicio. **Sin `recursos.py` en la VM no se
   puede atribuir**: es lo primero a medir en la siguiente corrida.
4. **Sin rate limit ni fallas de sesión:** 0 respuestas 429 y 0 respuestas 401 en 13 min, con 55
   renovaciones de token.

**Pendiente para cerrar la medición en staging:** el rol Investigador (perfil de sync y propiedad),
`recursos.py` y `planes.py` en la VM durante y después de la corrida, la caída de Redis (Juan Ángel) y la
caché activa contra omitida (con Pamela). Con eso, repetir con 100k (carga de ~52 min a 32 ventas/s).

### Resultados locales (no son la medición de nube)

Equipo de desarrollo (Windows 11, Docker Desktop con 8 GB), 10k ventas del generador 1.3.0. Los 20
servicios no caben juntos en 8 GB: se midió por rondas. **Estos números solo prueban que la suite
funciona**; la medición que se presenta es la de staging.

| Corrida | Usuarios | Peticiones | Fallas HTTP | Fallas negocio | p95 |
|---|---|---|---|---|---|
| Humo ronda A (catálogo, investigador, analista, gerente; 14 servicios) | 1–12 | 235 | 0 | 0 | 140 ms |
| Humo ronda B (administrador, analista, gerente; 12 servicios) | 1–12 | 216 | 0 | 0 | 88 ms |

**Caché de catálogos encendida contra apagada (local, 27-nov):** 200 consultas secuenciales por ruta
como Analista, con 10 de calentamiento. `GET /v1/units`: p50 6.7 / p95 9.4 ms con caché y 6.5 / 10.3 ms
con `CATALOG_CACHE=off`; `GET /v1/product-categories`: 6.7 / 12.9 ms con caché y 6.6 / 9.8 ms sin ella.
**Sin diferencia medible en local**: los catálogos son tablas chicas y en el mismo equipo leer Postgres
cuesta lo mismo que leer Redis; el tiempo lo domina la validación de la sesión, que va a Redis en ambos
casos. La comparación que importa es en staging bajo carga (la etapa alta de Locust), con el mismo
interruptor.

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
- **Antivirus que inspecciona HTTPS** (Avast en el equipo de la medición): re-firma cada certificado
  con su raíz, que está en el almacén de Windows pero no en `certifi`, el paquete de `requests`. Sin
  arreglo, todas las peticiones de Locust fallan con status 0 (`CERTIFICATE_VERIFY_FAILED`) aunque
  `sesiones.py` y `preparar.py` sí conecten. El locustfile junta las raíces del sistema y las de certifi
  en `carga/.ca-sistema.pem` y verifica contra él (la verificación sigue activa). La inspección agrega
  latencia: para cifras limpias, exceptúa el host en el antivirus o corre Locust desde la VM.
- **`/v1/health` no se publica en staging** (`routes.caddy`, `@interno`): Locust revisa el estado con
  `GET /v1/monitoring/services` y una sesión de administrador.
- **Un solo proceso:** la cola de promociones por aprobar y el registro de lotes para la propiedad viven
  en memoria. En modo distribuido (`--master`/`--worker`) cada worker tendría los suyos.
- **El p95 por servicio** del resumen es el de su ruta más lenta: Locust da percentiles por ruta, no por
  grupo de rutas.
