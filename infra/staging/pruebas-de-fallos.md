# Pruebas de fallos

Registro del 26 de noviembre de 2026, hora de Monterrey (UTC−06:00).
Los ensayos usaron datos sintéticos y servicios aislados. La ejecución de
arranque e ingesta corresponde a `5963356` más los cambios de la
[actualización de staging](https://github.com/JuanAPG/retail-platform/pull/140).
La repetición de servicio detenido y archivos parte del checkout `b803f48`.
Se reutilizaron PostgreSQL 16, Redis 7 y MongoDB 7 del entorno de prueba.
Las consultas públicas se realizaron sin sesión. El usuario confirmó que
staging recibió la actualización. Los digests de la VM quedan pendientes de
registrar.

## Resultado de los seis fallos

| Fallo y forma de inducirlo | Durante el fallo | Tras recuperar la dependencia | Correlación o evidencia |
|---|---|---|---|
| **Servicio detenido**. Terminar el proceso de Auth (3101) que sondea Monitoreo (3120). | El puerto rechazó la conexión. Monitoreo pasó a `degradado` a los 29,68 s y a `caido` a los 59,79 s, con dos fallos consecutivos. | El health de Auth volvió en 1,02 s tras reiniciar. Monitoreo pasó a `operativo` en 29,97 s. El login y la lectura de cuatro puntos del historial devolvieron 200. | `qa-detencion-85f713c503` |
| **Redis detenido**. Parar el contenedor aislado y consultar un lote de 3111 con sesión. | La ruta protegida devolvió 503 en 0,45 s. | Tras arrancar Redis y autenticarse de nuevo, la lista devolvió 200 y recuperó los lotes previos. | `qa-fault-28d45c2d41` · 21:41:49 UTC |
| **MongoDB sin responder**. Pausar el proceso aislado y pedir el historial de Monitoreo. | 503 en 2,51 s con el plazo de aplicación. El primer ensayo había superado 14 s antes del ajuste. | Al reanudar MongoDB se recuperaron los 15 puntos previos. | `qa-fault-5fdede7e24` · 21:45:20 UTC |
| **PostgreSQL detenido**. Parar el contenedor aislado y consultar el estado de 3111 y los lotes. | Health en `degraded`. La consulta protegida devolvió 503 en 0,04 s. | Al arrancar PostgreSQL se recuperó la consulta de los lotes. | `qa-fault-0f774303c1` · 21:41:52 UTC |
| **Archivos**. Interrumpir el almacén local de Documentos (3108) durante la generación de un XLSX y simular la pérdida de un PDF. | El XLSX devolvió 503 y quedó en `fallido`, sin aviso. El intento de obtener una URL devolvió 409. Tras retirar el PDF, su descarga también quedó bloqueada con 409 al pedir la URL. | El reintento del XLSX devolvió 201 para el mismo registro, ya `disponible`, con un solo aviso. El PDF se regeneró bajo el mismo ID sin repetir el aviso. | [Suite HTTP de archivos](../../services/documents-service/test/archivos.spec.ts) |
| **Timeout y pérdida de acuse**. Retener la respuesta después de que Core confirme la venta. | 3111 devolvió 503 a los 10,01 s y dejó el lote en `confirmando`. | El reintento devolvió 200, una repetida y **cero nuevas**. SQL confirmó una sola venta y una sola canasta para ese folio. | `qa-acuse-25ee4e8a53` · 21:36:32 UTC |

En el ensayo de detención, Auth dejó de escuchar a las 16:23:04 de
Monterrey (22:23:04 UTC). Monitoreo registró `degradado` a las
22:23:34 UTC, `caido` a las 22:24:04 UTC y `operativo` a las
22:24:34 UTC. El intervalo de sondeo fue de 30 s.

La verificación de archivos de Ingesta (3111) cubrió el rechazo
controlado de una referencia válida de prueba con el bucket sin configurar
(503, `qa-fault-7a22121ec2`). El flujo de Documentos usa su adaptador
local, Redis y MongoDB reales y dobles HTTP de Notificaciones y Auditoría.
La suite HTTP aprobó 14 de 14 pruebas. La interrupción y la
recuperación del bucket privado de GCS siguen pendientes.

La verificación de Ingesta también cubrió un CSV de **5.001 filas** y la
revisión de una fila con `PRECIO_INVALIDO`. La prueba previa de
confirmación de las 5.001 filas y reenvío registró **5.001 repetidas y
cero inserciones adicionales**. El respaldo PostgreSQL (`pg_dump -Fc`) se restauró mediante
`pg_restore --exit-on-error` en otra base. Coincidieron 9 usuarios, 8
ventas, 8 canastas, 4 lotes, 5.006 filas de ingesta y 6 fuentes. El folio
de la prueba de pérdida de acuse conservó una venta y una canasta.
[Ingesta y recuperación de cuenta](https://github.com/JuanAPG/retail-platform/pull/130) ·
[Registro de arranque y restauración](evidencia-recuperacion.md)

## Evidencia de seguridad

| Control | Evidencia |
|---|---|
| Acceso público de staging | El 26 de noviembre, el origen de la demo respondió 200. Las rutas `/api/transactions-ingestion-service/v1/transaction-imports` y `/api/monitoring-service/v1/monitoring/services` devolvieron 401 sin sesión. Las rutas `/api/auth-service/v1/health` y `/api/auth-service/docs` devolvieron 404. La prueba usó el origen HTTP de la demo sin enviar credenciales. |
| Sesiones y roles | En local se comprobaron 401 para peticiones sin sesión y 403 para perfiles sin permiso. Con Redis detenido, 3111 respondió 503 antes de entregar lotes. [Ingesta y reglas de acceso](https://github.com/JuanAPG/retail-platform/pull/130) · [Recuperación](evidencia-recuperacion.md) |
| Límite de inicio de sesión | Redis real, con umbral de prueba de tres intentos en tres segundos. Se observaron 401, 401, 401 y 429 con `Retry-After`. Al expirar la ventana, la siguiente solicitud devolvió 401. El valor predeterminado del servicio es 15 por 60 s. El registro conserva IP y correlación y omite correo, contraseña y tokens. [Prueba y configuración](https://github.com/JuanAPG/retail-platform/pull/101) |
| Recuperación de cuenta | Con SMTP de pruebas, el correo existente y el desconocido obtuvieron 202. Redis registró un TTL de unos 900 s. Dos usos simultáneos del mismo enlace devolvieron un 200 y un 400. El cambio invalidó el acceso anterior y su refresh token. [Pruebas de recuperación](https://github.com/JuanAPG/retail-platform/pull/130) |
| Integridad y trazabilidad de auditoría | Una edición de Segmentación (3112) y una captura de Disponibilidad (3114) se localizaron en la bitácora con sus correlaciones. Administrador y Auditor pueden consultar el verificador de la cadena SHA-256. La migración selló dos eventos previos y detectó un cambio en una copia. Para detectar la pérdida de los últimos eventos hace falta comparar con un respaldo o un punto de control externo. [Pruebas de auditoría](https://github.com/JuanAPG/retail-platform/pull/97) |
| Archivos privados y firma temporal | En el adaptador local, un perfil sin permiso recibió 403 y un proveedor recibió 404 para un recurso ajeno. La firma autorizada duró 300 s y la descarga coincidió con el SHA-256 registrado. La firma inválida o vencida devolvió 404. La bitácora registró la emisión y excluyó la URL. [Suite HTTP de archivos](../../services/documents-service/test/archivos.spec.ts) |
| Privacidad de avisos | La prueba de preferencias verificó que un aviso de aprobación pendiente sigue visible cuando se desactivan los informativos. Otro destinatario recibió 404 al consultar ese aviso. [Prueba de preferencias](https://github.com/JuanAPG/retail-platform/pull/100) |

## Evidencia pendiente de staging

- Repetir los seis casos con datos sintéticos en una réplica con el
  manifiesto de la VM. Para cada uno, guardar SHA, digests, hora UTC
  y local, correlación, tiempos de detección y recuperación, códigos HTTP,
  conteos persistidos y respuesta de la operación posterior.
- Completar el caso de GCS con un bucket de prueba. Guardar resultados de
  escritura, lectura autorizada, expiración de firma V4 y recuperación
  después de una interrupción controlada. Repetir el flujo de Ingesta
  desde objeto y comprobar que el mismo folio siga apareciendo una sola vez.
- Confirmar la recuperación desde el correo de prueba de staging sobre HTTPS.
  Adjuntar los códigos y tiempos sin incluir enlaces de recuperación,
  credenciales, JWT ni URLs firmadas.
- Adjuntar los logs de aplicación por correlación, la última muestra de
  CPU, memoria, disco, red y uptime, y el estado de la unidad del Ops Agent
  de `maquina-01`. El entorno de pruebas carecía de una identidad de GCP
  para recoger evidencia de la VM. [Consultas y criterios](actualizacion.md)
