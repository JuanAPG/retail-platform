# Generador y cargador de datos del Parcial 3

Datos de **prueba** con semilla para el volumen del Parcial 3: Locust, planes de consulta y los
servicios de analítica (canasta típica, pronóstico, elasticidad, asociaciones, clustering).
Ninguna persona real: las ventas son de tiendas y zonas agregadas (RN-02).

| Archivo | Qué hace |
|---|---|
| `db/generar_datos_parcial3.py` | Genera catálogo, ventas en CSV, existencias y un manifiesto con hashes y casos de control. |
| `db/cargar_datos_parcial3.py` | Da de alta el catálogo y las existencias y carga las ventas **por los servicios** (HTTP, con usuarios y permisos de la Matriz). Nunca escribe en la base a mano. |
| `db/test_generador_parcial3.py` | 32 pruebas del generador (reproducible, topes, casos de control, cobertura). |
| `db/test_cargador_parcial3.py` | 29 pruebas del cargador, sin red (idempotencia, 409, reintentos, errores, existencias). |

Solo biblioteca estándar de Python (3.10+). La salida va a `db/generados/`, que está en
`.gitignore`: se regenera idéntica con la semilla.

## 1. Generar

```bash
python db/generar_datos_parcial3.py --transacciones 10000      # -> db/generados/10000/
python db/generar_datos_parcial3.py --transacciones 100000
python db/generar_datos_parcial3.py --transacciones 500000
```

| Parámetro | Default | Para qué |
|---|---|---|
| `--transacciones` | 10000 | Ventas (= canastas). Mínimo 5,000: el control de D-37 necesita al menos 100 canastas del grupo en el mes de control (con 10k son 300). |
| `--semanas` | 52 | Ventana de ventas. Mínimo 16 (controles de 11 y 12 semanas y un mes completo). |
| `--hasta` | 2026-11-22 | Último día; debe ser domingo, para cerrar con semanas completas. |
| `--tiendas-por-zona` | 4 | De 2 a 4 en las zonas normales. |
| `--semilla` | 42 | Misma semilla y parámetros = mismos bytes (mismo SHA-256). No usa la hora actual. |
| `--max-mb` | 4.5 | Tope por archivo; el importador de core-process acepta 5 MB. |
| `--max-lineas` | 4000 | Tope de líneas por archivo; `0` lo desactiva. Ver §5. |
| `--salida` | `db/generados/<transacciones>` | Carpeta de salida. |

Ningún archivo parte una venta: cada folio queda completo en un solo CSV. Un tope más chico que
la venta más grande se rechaza antes de escribir nada.

### Qué genera

- `catalogo.json`: zonas, tiendas, categorías y productos con sus presentaciones.
- `ventas-0001.csv …`: formato de la importación CSV de core-process
  (`folio,fecha,tienda,sku,presentacion,cantidad,precio`), fechas con huso `-06`
  (America/Monterrey).
- `existencias.json`: una captura de existencia por tienda y presentación (448 con los defaults),
  con `stock` y `haceHoras` (antigüedad). No lleva fechas: el cargador fecha cada captura desde la
  hora de la carga, porque un dato vale 7 días (D-38) y con fechas fijas saldría vencido.
- `manifiesto.json`: parámetros, totales, bytes y SHA-256 de cada archivo, la huella de las ventas,
  la de las existencias y los casos de control con su valor esperado.

| Zona | Segmento | Tiendas | Perfil |
|---|---|---|---|
| Zona Valle | Ingreso alto (ING_3) | 4 | 4.3 productos por canasta, precios +8 % |
| Zona Centro | Ingreso medio (ING_2) | 4 | 3.4 productos por canasta |
| Zona Oriente | Ingreso bajo (ING_1) | 4 | 2.6 productos por canasta, precios −5 % |
| Zona Norte (nueva) | Ingreso bajo (ING_1) | 2 | Zona chica a propósito: 9 ventas en todo el periodo (D-36) |

Son 14 tiendas (3 del seed y 11 nuevas) y 26 productos en 6 categorías (4 del seed y 22 nuevos).
La demanda tiene un ciclo de 4 semanas y tendencia; el precio sigue un ciclo de 6 niveles con su
elasticidad; hay dos asociaciones sembradas (frijol → tortilla 0.60, leche → cereal 0.45).

**Existencias.** Fuera de los controles, cada presentación está agotada (stock 0) con una
probabilidad que depende del segmento de la zona: 5 % en ING_3, 10 % en ING_2 y 20 % en ING_1.
Es una regla **sintética** del generador, para que la accesibilidad tenga una diferencia que
mostrar entre zonas; no es un dato observado. Las demás capturas tienen de 1 a 60 horas de
antigüedad al cargar, así que siguen vigentes al menos 4.5 días. Usan su propio generador
aleatorio: agregarlas no cambió ni un byte de los CSV de ventas.

## 2. Volúmenes medidos

Equipo local (Windows 11, Python 3.14), `--max-lineas 4000`:

| Volumen | Líneas | Tamaño | Archivos | Generación | SHA-256 de las ventas |
|---|---|---|---|---|---|
| 10k | 38,975 | 3.0 MB | 10 | 0.95 s | `9d90b6ca79dcba4a8d9714bb72781decf45672ee110c67512e9d7d8e4e33527c` |
| 100k | 375,384 | 29.1 MB | 94 | 9.1 s | `8f94a5b43f66e6c3d97a42d7a66c292273c81b75ab53462a3f2369aaafa20cf2` |
| 500k | 1,868,901 | 144.7 MB | 468 | 47.4 s | `a7acd88fa8054253418b2b5569219c7f73c2b8cc308a91d9220e7ad99d64e757` |

Las existencias no dependen del volumen, solo de la semilla y de `--tiendas-por-zona`: con los
defaults, `existencias.sha256` es `b4856e33da26e1fc5b033e289a87cbf8ed74d3d3820f9eb3d8067bf36cf3209c`
en los tres volúmenes (verificado en 10k y 100k).

Si tu `manifiesto.json` trae otro `sha256` con los mismos parámetros, el generador cambió: los
casos de control de abajo ya no están garantizados.

## 3. Casos de control

Todos menos `elasticidad` se comprueban en `test_generador_parcial3.py` leyendo los CSV, no el
código que los sembró. La elasticidad solo se siembra: el valor que salga se mide con algorithms-core.

| Id | Dónde | Qué se espera | Quién lo usa |
|---|---|---|---|
| `D-37-frontera` | Zona Centro, oct-2026 (300 canastas) | Café en 60 canastas (20 %) **sí** es típico; avena en 57 (19 %) **no**. | basket-analysis (D-37) |
| `D-36-zona-chica` | Zona Norte | 9 ventas en 2 tiendas: no disponible. | basket-analysis (D-36) |
| `D-36-pocas-ventas` | Quinoa (`BIO-QUI-500`) en Zona Oriente | 8 ventas: no disponible. | basket-analysis (D-36) |
| `D-40-patron` | Azúcar (`GEN-AZU-1KG`) en Zona Valle | Serie semanal exacta `40 + t + [8,0,−5,−3][t mod 4]`, precio fijo; últimas 4 semanas 96, 89, 85, 88. | demand-forecast (D-40, MAPE) |
| `D-40-historia-11` | `GEN-ENE-473` | 11 semanas de historia: 422. | demand-forecast (D-40) |
| `D-40-historia-12` | `GEN-COC-1L` | 12 semanas: 201. | demand-forecast (D-40) |
| `DF-2-unidades-mezcladas` | Huevo (`GEN-HUE-12`) | Se vende en `12 pza` y `1 kg`: 422. | demand-forecast (DF-2) |
| `elasticidad` | Frijol, queso, refresco | Inelástica (−0.5), unitaria (−1.0), elástica (−1.8). | algorithms-core (D-18) |
| `asociaciones` | Frijol → tortilla, leche → cereal | Lift > 1. | algorithms-core (D-17) |
| `D-38-cobertura-tienda` | Abarrotes Juárez (la 2.ª tienda de Zona Centro) | 9 básicos: Arroz faltante (todas sus presentaciones en 0), Pasta vencida (capturada hace 8 días), Aceite cubierto con una sola de sus dos presentaciones: **7/9 = 77.78 %**. | availability (D-38), decision (accesibilidad) |
| `D-38-cobertura-zonas` | Las 4 zonas | Huevo en 0 en las 4 tiendas de Zona Oriente: faltante de la zona, **88.89 %**. Con la semilla 42: Valle y Centro 100 %, Norte 88.89 % (papel, al azar). | availability (D-38, D-13) |

Los dos controles D-38 se calculan con las reglas del contrato de availability-service, y ese
cálculo se prueba contra los dos casos de control del contrato (50 % y 75 %). Suponen que los únicos
básicos activos del catálogo son los 9 del generador (así está el seed) y que se consulta dentro de
los 4.5 días siguientes a la carga.

Los productos de lanzamiento se venden cada semana en las 3 zonas normales con ≥ 10 ventas y ≥ 3
tiendas, para que D-36 no tape el caso de D-40.

Las 106 ventas del seed (`db/data_retail.sql`, ago–sep 2026) conviven con las generadas. No tocan
las ventanas ni los SKU de D-36, D-37 y D-40 (verificado en la base), pero sí comparten frijol, queso
y leche: elasticidad y asociaciones salen **cerca** del valor sembrado, no exactas.

## 4. Cargar

Requiere arriba auth, catalog, income-segmentation, availability y core-process (con Postgres y
Redis), y los usuarios del seed.

```bash
python db/cargar_datos_parcial3.py --datos db/generados/10000                    # todo
python db/cargar_datos_parcial3.py --datos db/generados/10000 --solo-catalogo    # catálogo + existencias
python db/cargar_datos_parcial3.py --datos db/generados/10000 --sin-existencias  # sin availability
```

| Paso | Servicio | Usuario (rol de la Matriz) |
|---|---|---|
| Zona nueva y tiendas | catalog-service | `admin@retail.mx` (Administrador) |
| Clasificación de la zona nueva | income-segmentation-service | `analista@retail.mx` (Analista comercial) |
| Categorías, productos y presentaciones | catalog-service | `gercategoria@retail.mx` (Gerente de categoría) |
| Existencias: una captura por tienda y presentación | availability-service | `investigador@retail.mx` (Investigador de mercado, D-28) |
| Ventas: vista previa + confirmación por archivo | core-process-service | `analista@retail.mx` (Analista comercial) |

En staging, con las rutas de Caddy (`/api/<servicio>/v1/*`):

```bash
python db/cargar_datos_parcial3.py --datos db/generados/500000 \
  --auth https://<host>/api/auth-service --catalog https://<host>/api/catalog-service \
  --core https://<host>/api/core-process-service --segmentacion https://<host>/api/income-segmentation-service \
  --availability https://<host>/api/availability-service \
  --password '<contraseña de staging>'
```

`--password Passw0rd123!` es el default del seed **local**; en staging pásala por argumento.

**Idempotente y reanudable.** Lo que ya existe se reutiliza. Un archivo ya confirmado responde 409
en core-process (mismo SHA-256) y se salta; uno validado que quedó sin confirmar se confirma; la
confirmación es reanudable y se reintenta hasta 3 veces. Si la carga se corta (red, token, equipo),
se vuelve a correr el mismo comando y sigue donde iba, sin duplicar.

**Existencias antes de la demo.** Cada captura lleva un `captureId` fijo por tienda, presentación
y **día de carga (UTC)**. Si vuelves a correr el cargador el mismo día, availability-service responde
`duplicada` y no crea nada. Si lo corres otro día, entran como capturas nuevas y renuevan la
vigencia. **Si pasaron más de 4 días desde la última carga, vuelve a correrlo antes de la demo**
(con `--solo-catalogo` tarda unos 20 s), o la cobertura empezará a salir vencida.

Si `investigador@retail.mx` responde 403 o no puede entrar, a tu base local le falta el rol
Investigador de mercado (se agregó al seed después). `db/data_retail.sql` es idempotente
(`ON CONFLICT DO NOTHING`): volver a correrlo lo agrega sin tocar lo demás.

**Se detiene, con un mensaje claro, si:** un CSV o `existencias.json` no coincide con su SHA-256 del manifiesto; availability-service
responde 400 o 409 a una captura; la
vista previa trae filas con error; un archivo quedó antes como `con_errores` o `cargado` (dice qué
importación descartar con `DELETE /v1/transactions/import/<id>`); la confirmación sigue incompleta
tras 3 intentos.

Cada corrida escribe `manifiesto-carga.json` junto a los datos: segundos por paso y por archivo,
id de cada importación y el `X-Correlation-Id` de la corrida (para buscarla en los logs).

### Tiempos de carga medidos (local, 10k)

| Corrida | Resultado | Tiempo |
|---|---|---|
| Solo catálogo, base sin él | 1 zona, 11 tiendas, 3 categorías, 22 productos, 4 presentaciones | 6.7 s |
| Catálogo + ventas | 10,000 ventas nuevas en 10 archivos, 0 omitidas | 229.6 s |
| La misma carga otra vez | 10 archivos `ya cargado`, 0 nuevas | 3.6 s |
| Existencias (con `--solo-catalogo`) | 448 capturas `aceptada` | 15.1 s |
| Existencias otra vez, el mismo día | 448 `duplicada`, 0 nuevas | 11.8 s |

Por archivo (~1,000 ventas, ≤ 4,000 líneas): vista previa 1.4–2.3 s, confirmación 15–24 s.
La confirmación inserta venta por venta (venta, líneas, canasta), a **~44 ventas/s**:

| Volumen | Estimado de carga |
|---|---|
| 100k | ~38 min |
| 500k | ~3 h |

Para 500k en staging, lánzalo con tiempo y en segundo plano (`nohup … &`); si se corta, se
vuelve a correr.

**Validación tras la carga de 10k** (consulta de solo lectura en Postgres): 10,000 transacciones,
38,975 líneas, 10,000 canastas, cantidad total 66,053 y monto $2,434,090.88, iguales a los CSV; la
serie de `D-40-patron` llega idéntica en sus 52 semanas.

**Validación de las existencias** (consultas a availability-service como Analista comercial):
Abarrotes Juárez 77.78 % con Arroz en `/shortages`, las 4 zonas con la cobertura y los faltantes
del manifiesto, y el Investigador recibe 403 al leer `/stock` (D-28: solo da de alta).

## 5. Límite de líneas del importador (`--max-lineas`)

La vista previa de core-process guardaba el staging de un archivo en **un solo INSERT** de 16
valores por línea, y Postgres acepta 65,535 por consulta: arriba de **4,095 líneas** respondía 500
aunque el archivo cupiera en 5 MB. Por eso el default es `--max-lineas 4000`.

El PR `fix/core-process-importacion-por-bloques` guarda el staging en bloques de 1,000 filas; con
él, un archivo de 38,975 líneas (3 MB) pasa la vista previa en 15.9 s. Cuando esté en `main` se
puede generar con `--max-lineas 0` (archivos de hasta 4.5 MB, ~10 veces menos archivos). El default
de 4000 funciona con las dos versiones, así que no hace falta cambiarlo.

## 6. Pruebas

```bash
python -m unittest db/test_generador_parcial3.py db/test_cargador_parcial3.py -v   # 61 pruebas
```

No necesitan servicios arriba: el generador escribe en una carpeta temporal y el cargador usa un
cliente falso con las mismas respuestas que core-process y availability-service.
