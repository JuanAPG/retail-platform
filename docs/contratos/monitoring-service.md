# monitoring-service (3120)

Contrato para revisión de T-04 y T-09 · D-44 y D-47 · Plantilla
`template-nest`. Todas las rutas siguientes son nuevas.

| Método y ruta | Acceso | Respuesta |
|---|---|---|
| `GET /v1/health` | Público | 200 con estado de sus dependencias. |
| `GET /v1/monitoring/services` | Administrador | 200 con último estado de los 20 servicios, incluido el monitor. |
| `GET /v1/monitoring/services/{service}/history?page=1&limit=20` | Administrador | 200 con hasta 24 h de sondeos del servicio, más recientes primero. |

La lista y el historial exigen JWT y sesión Redis. Sin sesión se devuelve
401, otro perfil recibe 403, un servicio desconocido devuelve 404 y la
imposibilidad de validar sesión en Redis devuelve 503. Envía
`Accept: application/json` o `application/xml`. La paginación utiliza
`data`, `total`, `page` y `limit`, según
[contrato transversal](paginacion.md). Toda respuesta lleva
`X-Correlation-Id`. [XSD](monitoring-service.xsd).

## Interpretación de un sondeo

El monitor verifica `/v1/health` cada 30 s. Un timeout de 3 s o dos
errores consecutivos marcan `caido`. El primer fallo sin timeout, una
dependencia configurada que falla o una latencia superior a 1.000 ms
marcan `degradado`. Un sondeo exitoso sin problemas vuelve a `operativo`.
Para un destino sin sondeo previo el estado es `sin_datos`. Una
dependencia que el servicio no usa figura como `no configurado`. El
bucket se comprueba desde el servicio que lo usa.

El historial se conserva 24 h en MongoDB y el último estado se guarda en
Redis. Las marcas de tiempo ISO 8601 se expresan en UTC y las latencias
en ms. `probeErrorsConsecutive` cuenta fallos del sondeo, por ejemplo
timeout, error de red o respuesta inválida. Una dependencia degradada
tiene su propio estado. Las respuestas de negocio 4xx/5xx se investigan
en logs o métricas HTTP, fuera del contador de sondeo.

Ejemplo de un elemento de `data`. Los valores nulos se omiten en XML.
El historial usa el mismo objeto que el estado actual.

```json
{"service":"availability-service","port":3114,"version":"1.0.0","status":"degradado","checkedAt":"2026-11-23T19:00:00Z","latencyMs":46,"probeErrorsConsecutive":0,"dependencies":[{"name":"postgres","status":"error","latencyMs":44},{"name":"mongodb","status":"no configurado","latencyMs":0},{"name":"redis","status":"ok","latencyMs":2},{"name":"bucket","status":"no configurado","latencyMs":0}]}
```

[Ejemplo XML de estado](ejemplos/monitoring-estado.xml).
Ejemplo de rechazo para un usuario autenticado con otro perfil.

```json
{"statusCode":403,"message":"Tu rol no tiene acceso a este recurso.","code":"FORBIDDEN","path":"/v1/monitoring/services","timestamp":"2026-11-23T19:00:00Z"}
```

El cliente obtiene el prefijo de este servicio de la configuración del
ambiente. En Compose es `http://localhost:3120`; agrega
`/v1/monitoring/services` una sola vez. El panel web debe probar el estado
actual y el historial antes de cerrar T-09.
