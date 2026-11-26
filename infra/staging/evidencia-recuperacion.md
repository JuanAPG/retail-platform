# Evidencia de arranque y recuperación

## Ejecución local del 26 de noviembre de 2026

Base de código `5963356` con los cambios de este PR. PostgreSQL 16 y Redis 7
corrieron en un proyecto Compose aislado con volúmenes nuevos. MongoDB 7
usó un directorio de datos nuevo. Se arrancaron 14 aplicaciones desde el
checkout con las variables renderizadas por Compose, traduciendo los
nombres de red a puertos locales. El arranque de todos los contenedores del
Compose queda como verificación pendiente. El entorno local usa almacenamiento
de Docker VFS con espacio restringido.

- Las ocho migraciones completaron y la segunda ejecución conservó seis
  fuentes y seis políticas de retención. `postgres-migrations` impide
  arrancar los consumidores del esquema si falla psql.
- Los 14 health consultados devolvieron `ok`. Canasta y Pronóstico
  reportaron PostgreSQL como `no configurado`, conforme a sus dependencias.
  Compose renderiza 18 servicios de negocio. Faltan Promoción (3115) y
  Seguimiento (3117) en `main`.
- El CSV de 5.001 filas obtuvo 201 en el legado de Core y en 3111.
  Un lote mixto devolvió `PRECIO_INVALIDO` en su fila de prueba. El primer
  acuse incorporó una venta y el reenvío del mismo archivo incorporó cero.
- El recorrido de sincronización envió una captura real de 3118 a 3114 y
  persistió una fila en PostgreSQL. El reenvío devolvió una duplicada. Caso
  sintético `BIO-QUI-500` · `500 g` · `Zona Centro`.
  Correlación `qa-sync-d7e9008d27`, presente en los logs de ambos servicios.

## Recuperación comprobada

| Escenario | Resultado observado en el entorno aislado |
|---|---|
| Respuesta lenta / pérdida de acuse | Core confirmó y se retuvo su respuesta. 3111 devolvió 503 a los 10,01 s y conservó el lote `confirmando`. Al reintentar devolvió 200, 1 repetida, 0 insertadas. PostgreSQL conservó exactamente una venta y una canasta. Correlación `qa-acuse-25ee4e8a53`. |
| Redis detenido | 3111 devolvió 503 en 0,45 s para la petición protegida. Después de iniciar Redis y abrir sesión, devolvió 200 y se pudieron consultar los lotes. Correlación `qa-fault-28d45c2d41`. |
| PostgreSQL detenido | El health de 3111 cambió a `degraded` y la consulta devolvió 503 en 0,04 s. Al iniciar PostgreSQL, los lotes quedaron disponibles. Correlación `qa-fault-0f774303c1`. |
| MongoDB sin responder | La consulta de historial superaba 14 s en la primera prueba. Con el plazo de aplicación, devolvió 503 en 2,55 s. Al reanudar MongoDB volvieron a verse los 14 puntos previos. Correlación `qa-fault-327efd62eb`. |
| Referencia a objeto sin bucket en local | 3111 devolvió 503 para una referencia sintética válida. Correlación `qa-fault-7a22121ec2`. La operación real sobre objetos privados queda para staging. |
| Restauración PostgreSQL | `pg_dump -Fc` y `pg_restore --exit-on-error` a otra base en el entorno aislado. Coincidieron 9 usuarios, 8 ventas, 8 canastas, 4 lotes, 5.006 filas de ingesta y 6 fuentes. El folio del acuse perdido conservó una venta y una canasta. |

## Verificación externa y evidencia por completar en la VM

El origen HTTP devolvió 200. En 3111, 3118, Core, Monitoreo y Elasticidad
se obtuvo 401 sin sesión. El health interno devolvió 404 en el proxy.
Canasta, Pronóstico y Gobierno de Datos devolvieron 502. Estos resultados
permiten comprobar el enrutamiento público y el estado observado de esas
rutas. La identidad de despliegue y el SHA de la VM deben verificarse desde
GCP o con su manifiesto de imágenes.

Usa una cuenta de aplicación autorizada y un lote sintético para el recorrido
autenticado de staging. Guarda por caso hora local y UTC, SHA y digests,
correlación, síntoma, código HTTP, tiempo de detección, recuperación,
conteos persistidos y resultado de una operación posterior. Ejecuta fallos
controlados en una réplica aislada o en la ventana autorizada.

| Caso de staging | Evidencia a recoger |
|---|---|
| Servicio detenido | Dos sondeos fallidos o un timeout, hora de detección, recuperación y respuesta de negocio posterior. |
| Redis | 503 al validar sesión, restauración del acceso y lectura del estado e historial. |
| MongoDB | 503 al consultar historial. Verificar que los puntos previos reaparecen al volver la conexión. |
| PostgreSQL | Health degradado, operación protegida fallida y consulta posterior con el mismo lote. |
| Archivos privados | Bloqueo controlado en el bucket de pruebas, respuesta del cliente y recuperación. Verificar escritura, lectura autorizada y expiración de firma V4. |
| Respuesta lenta | Repetir pérdida de acuse sobre datos de prueba y verificar conteos en Ingesta, Core y canastas. |
| Respaldo y recuperación | Restaurar en un destino separado, comparar tablas y ejecutar una operación posterior. Añadir respaldo de MongoDB y Redis según su persistencia. |

Adjunta las consultas de logs, métricas y estado del agente descritas en
[la actualización](actualizacion.md). El recorrido de apps empaquetadas y
la verificación del Ops Agent requieren acceso a los paquetes y a GCP.
