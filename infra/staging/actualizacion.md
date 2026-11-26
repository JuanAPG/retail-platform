# Actualización y verificación de staging

## Preparar la versión

Fija un SHA aprobado y conserva el manifiesto que está en ejecución antes de
cambiar servicios. Registra los digests actuales, las variables por nombre,
el estado de la VM y un respaldo de las bases. El Compose de este repositorio
sirve para desarrollo y pruebas aisladas. En staging, usa el manifiesto privado
de la VM y conserva la red, los volúmenes, las identidades y las referencias
a secretos ya configuradas.

| Componente | Qué actualizar o verificar |
|---|---|
| PostgreSQL | Ejecutar las migraciones por orden con `ON_ERROR_STOP=1` antes de levantar consumidores. Gobierno de Datos necesita fuentes, versiones y retención sembradas. |
| Auth, Core y 3111 | Publicar imágenes del mismo SHA. Mantener el Core compatible con el endpoint interno de ventas. Configurar bucket privado e identidad de carga de 3111. Activar SMTP de recuperación al terminar el mayor TTL anterior de acceso y disponer de una página HTTPS. |
| 3118 | Configurar `SYNC_DESTINO=http`, `AVAILABILITY_SERVICE_URL` y `PRICING_SERVICE_URL` usando los nombres internos de 3114 y 3103. Conservar Redis y MongoDB. |
| Monitoreo (3120) | Actualizar el límite de las operaciones Mongo. Validar historial durante una interrupción y después de recuperar la conexión. |
| 3113, 3116 y 3119 | Añadir las imágenes y las variables de sus entradas de Compose al manifiesto privado. Conservar el mismo JWT y Redis. La canasta consume Core, Catálogo y Segmentación. Pronóstico guarda corridas en Mongo y envía linaje a 3119. Gobierno de Datos escribe en PostgreSQL. |
| Proxy y web | Usar el mismo origen de demo como base de los clientes. En Vite, `VITE_INGESTION_URL=$STAGING_ORIGIN/api/transactions-ingestion-service` y las demás `VITE_*_URL` sin `/v1`. Revisar Caddy antes de recargar. El proxy quita `/api/<servicio>`. |
| Android y Electron | Fernando verifica los paquetes que se usarán en la demo. Deben admitir el origen HTTP acordado y usar su configuración por ambiente. Validar una operación por cliente y guardar su correlación. |

Cada servicio tiene su Dockerfile en `services/<servicio>/Dockerfile`.
3111 usa la raíz del repositorio como contexto para copiar los XSD.
Con el checkout posicionado en el SHA aprobado, prepara las imágenes sin
alterar el manifiesto activo. Usa el registro autorizado al publicar.

```bash
: "${RELEASE_REGISTRY:?Indica el registro autorizado}"
sha="$(git rev-parse HEAD)"
for servicio in auth-service core-process-service offline-sync-service \
  basket-analysis-service demand-forecast-service data-governance-service monitoring-service; do
  docker build --label "org.opencontainers.image.revision=$sha" \
    -t "$RELEASE_REGISTRY/$servicio:$sha" "services/$servicio"
done
docker build --label "org.opencontainers.image.revision=$sha" \
  -f services/transactions-ingestion-service/Dockerfile \
  -t "$RELEASE_REGISTRY/transactions-ingestion-service:$sha" .
```

La web usa `npm ci && npm run build` en `web/`, con las variables del
ambiente definidas antes de compilar. Etiqueta por SHA y registra los digests
antes de actualizar el manifiesto. Aplica la migración al Postgres de staging
mediante psql con la identidad de migración existente, tras respaldar y
detener escritores si el cambio lo requiere. Vuelve a ejecutar las consultas
de verificación en el mismo SHA. Usa la imagen anterior para rollback si
es compatible con el esquema nuevo. Si no hay compatibilidad, prueba el
respaldo en otro destino y acuerda el corte antes de conmutar.

## Comprobar arranque y operación

En el entorno de pruebas, usa un proyecto Compose con sus propios volúmenes
y puertos. En una máquina compartida, ajusta también los `container_name`
fijos mediante un override. Levanta PostgreSQL y Redis, aplica
`./infra/migrar-postgres.sh` con las mismas opciones de Compose y repítelo
para comprobar idempotencia. Por las dependencias de Compose, los servicios
afectados esperan a que el contenedor de migraciones termine correctamente.

- Consulta `/v1/health` internamente e inspecciona el resultado de cada dependencia.
  HTTP 200 confirma respuesta del proceso. El estado de la dependencia
  se comprueba en `status`, `checks` y `latencyMs`.
- Externamente, GET al origen web devuelve 200. GET a las rutas de
  negocio sin sesión devuelve 401. El health interno queda detrás del proxy.
- Ejecuta `services/transactions-ingestion-service/test/integration.py`
  solo sobre la semilla sintética aislada. Para staging usa una cuenta
  autorizada y un folio nuevo. Identifica los datos por SKU, presentación
  y nombre de zona. Obtén sus UUID en el entorno donde vas a probar.
- Captura en el portal la vista previa, el error de fila y el acuse. Reenvía
  el mismo archivo, conserva el resultado con cero inserciones y consulta
  en Core que el folio exista una sola vez. Registra SHA, fecha y
  `X-Correlation-Id`. Guarda en la evidencia los códigos y conteos.
  Excluye credenciales, JWT, enlaces de correo y URLs firmadas.

## Logs de aplicación, métricas y Ops Agent

Define `GCP_PROJECT`, `GCP_ZONE` y `STAGING_VM`. Los comandos consultan el
ID numérico de la instancia y filtran por ese ID y zona para evitar mezclar
datos de otras VMs. Usa una identidad con acceso de lectura a Compute,
Cloud Logging y Cloud Monitoring. El modo `agente` requiere SSH mediante
IAP y permisos de lectura del journal en la VM.

```sh
infra/staging/consultar-observabilidad.sh estado
infra/staging/consultar-observabilidad.sh agente
infra/staging/consultar-observabilidad.sh logs "$CORRELATION_ID"
infra/staging/consultar-observabilidad.sh metricas
```

- **Aplicación.** Busca el mismo ID en los logs locales del contenedor y
  en Cloud Logging. Si aparece solo en `docker logs`, comprueba el driver
  con `docker inspect --format '{{.HostConfig.LogConfig.Type}}' <contenedor>`
  y comprueba qué archivos, syslog o journal lee el Ops Agent. Una salida
  vacía significa que la consulta no encontró una entrada en esa ventana.
- **Métricas.** Registra fecha del último punto de CPU, memoria, disco, red
  y uptime. La CPU de Compute mide la VM desde la plataforma. La memoria
  y el uptime del Ops Agent confirman la ruta de ingesta del agente.
- **Agente.** Guarda estado de la unidad y subunidades, hora del arranque
  y errores recientes. Contrasta con un punto fresco en Cloud Monitoring
  y una petición reciente en Cloud Logging.

Documentación oficial de [ingesta del Ops Agent](https://docs.cloud.google.com/stackdriver/docs/solutions/agents/ops-agent/troubleshoot-run-ingest),
[métricas del Ops Agent](https://docs.cloud.google.com/monitoring/api/metrics_opsagent) y
[consulta de series](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list).
