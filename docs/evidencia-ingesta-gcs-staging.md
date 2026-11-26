# Ingesta y recuperación con GCS en staging

Ejecución del 26 de noviembre de 2026 a las 22:20 UTC en `maquina-01`, zona `northamerica-south1-c`, instancia `8881613095484925545`. Se comprobó el SHA `a2a7fad0ca9f62d90c2017a8d49d6eab34c608c0` en el checkout activo y en las etiquetas de los 15 contenedores de aplicación. Al consultar GitHub, `main` apuntaba a `b803f48486e7a18a0457f435492703969e353878`. La evidencia funcional corresponde al SHA desplegado. Las consultas de observabilidad se ejecutaron con el script del `main` remoto.

El origen de prueba fue `http://34.51.89.203`, a través de Caddy desde la VM. La correlación del recorrido fue `qa-gcs-27b36c5978d0`. La cuenta temporal tuvo el rol Analista comercial. Se usó un folio sintético nuevo y una segunda fila con precio inválido.

| Comprobación | Resultado |
| --- | --- |
| Login y vista previa por Caddy | Login 200, vista previa 201, una fila válida y una rechazada con `PRECIO_INVALIDO`. |
| Confirmación y reintento | Confirmación 200 con una inserción. Repetir la confirmación devolvió 200 y el mismo acuse. |
| Reenvío del mismo archivo | Vista previa 201, confirmación 200, una venta repetida y cero inserciones. |
| Referencia GCS en el servicio activo | 503 en 0,08 s. El servicio activo guarda originales en PostgreSQL y tiene `GCS_INGESTION_BUCKET` vacío. |
| Réplica temporal con GCS | Health 200, estado del bucket `ok`. La referencia ausente y la generación incorrecta devolvieron 404. |
| Escritura y recuperación en el bucket real | Escritura con la identidad adjunta 200, lectura anónima 401. Con la generación exacta, `from-object` devolvió 201 en 0,32 s. |
| Confirmación desde GCS | 200 con una venta repetida y cero inserciones. PostgreSQL conservó una venta y una canasta para el folio. |

Se usó el bucket privado existente `gcs_bucket_reportes` en una réplica interna de la imagen de ingesta `sha256:aa82b1eaa44838aece4eb1b6d72ee51efed76674d399f8fb29c4c416a4132cd2`. El objeto quedó bajo `ingestion/incoming/<UUID de la cuenta>/<archivo sintético>` como evidencia del lote. Este caso ejercitó la recuperación de una referencia inválida con una generación válida. Un corte del servicio de GCS queda fuera del alcance de esta prueba. Se retiró la réplica, se desactivó la cuenta y se eliminó su sesión.

## Observabilidad

La identidad adjunta `625832710485-compute@developer.gserviceaccount.com` ejecutó las consultas de Compute, Cloud Logging y Cloud Monitoring desde la VM. Cloud Logging devolvió entradas de la correlación en `gcplogs-docker-driver`. En los registros locales se encontraron ocho coincidencias en ingesta y tres en Core. La consulta de CPU de Compute devolvió un punto de las 22:18 UTC. Las consultas de uptime, memoria, disco y tráfico del Ops Agent devolvieron cero series en la ventana de 45 minutos, sin error de autorización. La inspección local de systemd mostró `LoadState=not-found` y `ActiveState=inactive` para `google-cloud-ops-agent.service`.
