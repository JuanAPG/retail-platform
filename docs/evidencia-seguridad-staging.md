# Evidencia de seguridad de staging HTTP

Pruebas del 26 de noviembre de 2026 en `maquina-01`, proyecto `mythic-evening-505221-n7`, zona `northamerica-south1-c`. Commit desplegado y probado `a2a7fad0ca9f62d90c2017a8d49d6eab34c608c0`.

## Configuración de la demo

- Origen `http://34.51.89.203`. Caddy 2.11.9 sirve la web desde `/srv/web` y publica TCP 80. Las pruebas de la demo entraron desde la VM por Caddy con la cabecera `Host: 34.51.89.203`. El origen HTTP transporta los tokens de las cuentas sintéticas sin cifrado de transporte.
- Los servicios y bases del proyecto Compose `retail-staging-http` se comunican por su red Docker. Caddy enruta `/api/<servicio>/v1/...` y bloquea las rutas internas de salud, transacciones y eventos definidas en el Caddyfile.
- JWT de acceso de 15 minutos y JWT de renovación de 7 días. Redis guarda las sesiones y el contador de intentos de acceso. El límite configurado por defecto es de 15 intentos en 60 segundos por dirección IP que ve Express.
- La demo no configura `AUTH_TRUSTED_PROXY`. Las solicitudes que llegan por Caddy pueden compartir el contador de la dirección del proxy. El límite probado corresponde a la ruta de login. El Caddyfile carece de un límite general de frecuencia.
- Ingesta limitada a 8 MiB y 10.000 filas por archivo. El original de ingesta se guarda en PostgreSQL. Los reportes se guardan en el bucket privado `gcs_bucket_reportes`, con URLs firmadas HTTPS válidas por 300 segundos.
- SHA-256 del Caddyfile `8813559d4409d7ac1e9975660c44eb091fc6d853b5f438a1d76f10ac3fc6d9a4`. SHA-256 del manifiesto Compose `a99aa454cd99e6942cc4ef6fa5be0a8520d11a333fc515f646be1ebb41664637`.

## Resultados por Caddy

| Control | Resultado observado |
| --- | --- |
| Acceso y renovación | Login y renovación HTTP 200. Los JWT emitidos indicaron 900 y 604.800 segundos. La renovación emitió dos tokens distintos y el acceso renovado consultó el catálogo con 200. |
| Reutilización de refresh | El refresh anterior devolvió 401. El token de acceso de la sesión recién renovada devolvió 401 al consultar el catálogo. |
| Cierre de sesión | Logout 200. El acceso y el refresh de esa sesión devolvieron 401 en peticiones posteriores. |
| Autenticación y rol | Petición de ingesta sin sesión 401. Proveedor que intenta listar lotes 403. |
| Permisos por lote | Dueño y administrador pudieron leer el lote con 200. Otro analista recibió 404 al leerlo y confirmarlo. El administrador recibió 403 al intentar confirmarlo. |
| Archivos válidos | CSV, JSON y XML devolvieron 201 y una fila válida por formato. Las tres vistas previas se descartaron con 200. |
| Archivos inválidos | Encabezado CSV inválido, JSON mal formado, JSON sin filas, XML fuera del XSD y XML con DTD recibieron 422. El tipo MIME discordante recibió 415. |
| Tamaño y paginación | Un archivo de 8 MiB + 1 byte y uno de 10.001 filas recibieron 413. La solicitud de 101 filas por página devolvió 200 con límite efectivo de 100. |
| JSON del login | El cuerpo mal formado y un campo adicional en el DTO recibieron 400. |
| Reporte privado | El Gerente generó el reporte y su PDF con 201. El Proveedor ajeno recibió 404 al solicitar la firma. El Gerente recibió 200. GCS devolvió 403 sin firma y 200 con la firma HTTPS. El SHA-256 de la descarga coincidió con el registrado. |
| Auditoría | El evento 82 registró la emisión del enlace firmado. La misma correlación contiene la creación del reporte y del archivo en los eventos 79 y 80. |
| Intentos fallidos | Contraseña incorrecta y correo inexistente devolvieron 401. |
| Origen de la demo | La raíz respondió 200 por HTTP, sin redirección. |

La correlación `qa-sec-b21076f91f` identifica el recorrido en la bitácora. Las credenciales, JWT y URL firmada se manejaron en memoria.

Caddy devolvió 404 para la salud de auth, Swagger, las rutas internas de transacciones y las escrituras internas de auditoría y notificaciones.

## Expiración y límite de login

La expiración de JWT se verificó con la misma imagen desplegada de `auth-service` en un contenedor temporal, con acceso de 5 segundos y renovación de 18 segundos. Se usó la red interna de staging y una cuenta sintética exclusiva. La consulta protegida por Caddy pasó de 200 a 401 al expirar el acceso. El refresh todavía vigente devolvió 200 y el refresh vencido devolvió 401. Los tiempos configurados en la demo se comprobaron en los JWT que emitió el despliegue habitual.

El contenedor temporal mantuvo el límite de la demo. En 60 segundos, el primer login válido y 14 intentos fallidos agotaron el cupo de 15. El intento 16 devolvió 429 con `Retry-After: 35`. La prueba usó una dirección interna distinta a la del proxy de la demo para evitar afectar a otros usuarios.

Pasada la ventana, el siguiente intento con credenciales incorrectas devolvió 401. El registro de auth-service contiene el evento `auth.login.failed` con correlación `qa-sec-b21076f91f-failed`, correspondiente al intento con contraseña incorrecta.

La imagen de auth usada en ambos recorridos tiene ID `sha256:b50293fd81c0c83439f4846d0baf683934c8e13e4fbf5f9c1e0e1eebc7451468`.

## Cierre del recorrido

La misma URL firmada que descargó el PDF con 200 devolvió 400 una vez transcurridos los 300 segundos de vigencia. El recorrido terminó sin diferencias frente a los estados HTTP esperados. Las cuentas sintéticas quedaron desactivadas, se eliminaron sus sesiones y se retiró el contenedor temporal.
