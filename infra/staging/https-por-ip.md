# HTTPS de staging por IP pública

El origen de la demo será `https://34.51.89.203`. Caddy solicita y renueva
un certificado gratuito de Let's Encrypt para la IP pública mediante ACME
con el perfil `shortlived` (160 horas). El reto HTTP-01 usa el puerto 80.
Caddy atiende el reto y redirige el tráfico web de HTTP a HTTPS.
[Certificados para IP](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/) ·
[Configuración TLS de Caddy](https://caddyserver.com/docs/caddyfile/directives/tls)

## Aplicar en la VM

1. En `maquina-01`, confirma en GCP que la IP está reservada y asignada a
   esa VM. Permite TCP 80 y 443 para la IP pública en el firewall de GCP
   y, si aplica, en el firewall del SO. Caddy requiere salida HTTPS hacia
   el servicio ACME y resolución DNS. Mantén privados los puertos de los
   servicios y bases. Confirma qué proxy tiene los puertos 80 y 443 y
   conserva su manifiesto y build web para volver a la versión anterior.
2. Usa Caddy 2.11.9, la versión con la que se validó esta configuración.
   En el manifiesto privado de staging, actualiza el proxy existente
   para usar [Caddyfile.ip](Caddyfile.ip) junto con
   [routes.caddy](routes.caddy). Coloca ambos archivos en el mismo
   directorio dentro del contenedor. `STAGING_PUBLIC_IP` es opcional y
   admite otra IP pública reservada. Publica 80 y 443 por TCP y conecta
   Caddy a la red donde resuelven los nombres de los microservicios.

   Si el proxy se ejecuta con la imagen oficial de Caddy, estas son las
   entradas de su servicio. Ajusta las rutas de origen al manifiesto de
   staging y reutiliza su volumen de datos cuando exista.

   ```yaml
   image: caddy:2.11.9-alpine
   ports:
     - "80:80"
     - "443:443"
   volumes:
     - ./Caddyfile.ip:/etc/caddy/Caddyfile:ro
     - ./routes.caddy:/etc/caddy/routes.caddy:ro
     - ./web-dist:/srv/web:ro
     - caddy_data:/data
     - caddy_config:/config
   ```

   Declara los volúmenes nombrados en el manifiesto. Conserva `/data`
   entre despliegues, ya que guarda la cuenta ACME, los certificados y
   sus claves. Si Caddy funciona como servicio del sistema, coloca los
   dos archivos bajo `/etc/caddy` y conserva el directorio de datos del
   usuario de ese servicio. El proxy debe seguir resolviendo los
   destinos internos que usa el manifiesto.
3. Desde `web/`, ejecuta `npm ci` y
   `npm run build -- --mode staging`. Este build usa `/api/<servicio>`
   en el mismo origen. Si el entorno de compilación ya tiene variables
   `VITE_*_URL`, elimina las antiguas o actualízalas a HTTPS porque
   tienen prioridad. Publica `web/dist` en el directorio servido como
   `/srv/web`.
4. Valida los archivos con el mismo binario antes de activar el cambio.
   El ejemplo supone que el servicio del manifiesto se llama `caddy` y
   monta los archivos como arriba. Ejecuta los comandos desde el
   directorio del manifiesto, o usa sus opciones de Compose habituales.

   ```sh
   docker compose run --rm --no-deps --entrypoint caddy caddy \
     validate --config /etc/caddy/Caddyfile --adapter caddyfile
   docker compose up -d --no-deps caddy
   docker compose logs --since 10m caddy
   ```

   Con Caddy instalado como servicio del sistema, valida el archivo
   usado por la unidad con `caddy validate --config /etc/caddy/Caddyfile
   --adapter caddyfile`. Aplica el cambio con `sudo systemctl reload caddy`.
   Si actualizaste el binario, ejecuta `sudo systemctl restart caddy`
   para que el proceso arranque con la nueva versión. Si se sustituye
   un proxy distinto, los puertos pasan a Caddy durante
   el corte. Conserva el arranque y el manifiesto del proxy anterior
   para restaurarlos si falla la verificación.
5. Tras validar HTTPS, cambia en Auth
   `AUTH_RESET_WEB_URL=https://34.51.89.203/recuperar-contrasena` y aplica
   la configuración del servicio. Conserva las referencias al SMTP
   autorizado y prueba la entrega con una cuenta de aplicación. Cambia
   en Android y Electron las bases a
   `https://34.51.89.203/api/<servicio>/` y recompila los paquetes. En
   Android configura las propiedades `retail.release.authUrl`,
   `retail.release.catalogUrl`, `retail.release.pricingUrl` y
   `retail.release.syncUrl` del build. En Electron usa las variables
   `VITE_*_URL` del modo staging y ejecuta `npm run build:staging`.

## Verificar desde fuera de GCP

```sh
curl -sSI http://34.51.89.203/
curl -fsS -o /dev/null -w '%{http_code}\n' https://34.51.89.203/
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://34.51.89.203/api/transactions-ingestion-service/v1/transaction-imports
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://34.51.89.203/api/auth-service/v1/health
openssl s_client -connect 34.51.89.203:443 -noservername \
  -verify_ip 34.51.89.203 -verify_return_error </dev/null
```

La primera petición debe devolver 308 con destino HTTPS. Las siguientes
deben devolver 200 para la web, 401 para la API protegida sin sesión y
404 para el health privado. El certificado debe superar la validación
normal de cadena e IP. Después, comprueba el inicio de sesión, la
recuperación por correo y una llamada desde cada paquete actualizado.
El navegador guarda las sesiones de HTTP y HTTPS en orígenes separados,
así que los usuarios web deben iniciar sesión de nuevo. Registra la
expiración al habilitar HTTPS y comprueba la primera renovación en los
logs. Para volver atrás, restaura el manifiesto y el build web anteriores
y conserva los datos de Caddy.
