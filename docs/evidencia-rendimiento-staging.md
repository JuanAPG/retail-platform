# Evidencia de rendimiento de staging

Medición del 26 de noviembre de 2026 en `maquina-01`, con 2 vCPU y 7,5 GiB de RAM. Las peticiones HTTP se originaron en la VM y pasaron por Caddy con `Host: 34.51.89.203` y una cuenta sintética de Analista comercial. Correlación `qa-perf-dfff91161b7e`.

El SHA desplegado y medido fue `a2a7fad0ca9f62d90c2017a8d49d6eab34c608c0`. El actualizador Python descargó `960c0dee26d37f66654f5f8be98307b948e37135` de `main` y detuvo su activación al detectar migraciones de gobierno de datos, promociones y recomendaciones, además de cambios en el esquema y Compose.

Staging tenía 107 ventas, 165 líneas de venta y 107 canastas. Las cifras de generación y carga con 10.000 ventas siguen en `db/README-generador.md` de `main`. Las tablas siguientes describen una prueba breve sobre el volumen actual de staging.

## Concurrencia y consultas HTTP

Se hicieron 180 solicitudes por nivel, 60 de listado paginado de ventas de agosto de 2026, 60 de ticket promedio del mismo mes y 60 de catálogo de productos. Se reutilizó un JWT. Cada trabajador inició su siguiente solicitud al terminar la anterior. El cliente midió el tiempo hasta leer la respuesta completa.

| Solicitudes simultáneas | Solicitudes/s | p50 total (ms) | p95 total (ms) | Máx. (ms) | Errores |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 49,4 | 16,5 | 45,3 | 138,0 | 0 / 180 |
| 5 | 60,4 | 64,6 | 231,2 | 373,3 | 0 / 180 |
| 10 | 53,6 | 158,5 | 372,0 | 956,7 | 0 / 180 |

| Consulta | p95 con 1 (ms) | p95 con 5 (ms) | p95 con 10 (ms) |
| --- | ---: | ---: | ---: |
| Listado de ventas | 52,7 | 254,1 | 454,3 |
| Ticket promedio | 21,2 | 144,9 | 313,1 |
| Catálogo de productos | 34,8 | 163,6 | 296,1 |

El mayor rendimiento de estas tres corridas se observó con cinco solicitudes simultáneas. Con diez bajó el rendimiento y aumentó la latencia, especialmente en el listado de ventas. Cada corrida duró entre 3 y 4 segundos.

## Procesamiento, índices y caché

- **Procesamiento.** Tres solicitudes de vista previa a `transactions-ingestion-service` validaron 100 filas JSON cada una, con 18.500 bytes por archivo y HTTP 201. Tomaron 356,0, 142,6 y 166,9 ms. Las tres vistas previas se descartaron con HTTP 200 y la cuenta sintética se desactivó.
- **Consultas e índices.** Con `EXPLAIN (ANALYZE, BUFFERS)` en modo de solo lectura, PostgreSQL eligió escaneo secuencial en los tres casos. El listado por fecha con límite 20 tomó 0,223 ms de ejecución, el ticket promedio 0,120 ms y la búsqueda por tienda y folio 0,042 ms. El índice de fecha y el índice único de tienda y folio están presentes. Como diagnóstico, al desactivar el escaneo secuencial solo dentro de una transacción, el listado usó `idx_transacciones_fecha` y tomó 0,063 ms. Esos tiempos son muestras individuales sobre una tabla de 107 ventas.
- **Caché.** Redis informó que `catalog:units` estaba ausente. La primera consulta a unidades tardó 22,1 ms y creó la clave con TTL de 3.600 segundos. Las 20 consultas siguientes devolvieron el mismo contenido, con p50 de 7,4 ms y p95 de 21,7 ms.

## Recursos de la VM

La memoria disponible fue de 4,04 GiB antes de la corrida, 3,89 GiB al iniciar la etapa de diez solicitudes simultáneas y 3,88 GiB después. El disco reportó 50 % de uso y 76 GiB disponibles. Durante la etapa de diez se tomó una muestra de Docker Stats.

| Contenedor | CPU de la muestra | RAM |
| --- | ---: | ---: |
| Caddy | 8,0 % | 31,7 MiB |
| Core Process | 40,8 % | 105,2 MiB |
| Catálogo | 21,3 % | 86,0 MiB |
| PostgreSQL | 24,0 % | 86,3 MiB |
| Redis | 1,2 % | 11,0 MiB |

Las muestras de recursos y latencia corresponden a la carga breve indicada. La capacidad sostenida y los resultados a 10.000 o más ventas requieren sus propias corridas.
