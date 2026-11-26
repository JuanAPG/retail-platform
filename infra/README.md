# Infraestructura local y VM de demo

## Levantar el entorno local

```bash
docker compose -f infra/docker-compose.yml up -d postgres pgadmin api web redis
docker compose -f infra/docker-compose.yml logs -f api
```

Front en `http://localhost:5173`, API/Swagger en `http://localhost:3001/docs`,
12 microservicios en `3101–3110`, `3112` y `3114` (`/v1/health` en cada uno).

Con volumen nuevo, Compose inicializa `schema.sql` y `data_retail.sql`.
Para conservar una base de desarrollo previa, guarda un respaldo y
detén los procesos que escriben antes de migrar. Ejecuta desde la raíz.

```bash
./infra/migrar-postgres.sh
docker compose -f infra/docker-compose.yml up -d auth-service catalog-service income-segmentation-service availability-service
```

El script aplica en orden las migraciones idempotentes bajo
`db/migraciones/`, conserva el volumen y aborta ante el primer error SQL.
Se puede repetir. Acepta opciones de Compose como `-f ruta/override.yml`.
Consulta [la guía de staging](staging/README.md) para el proxy HTTPS,
el inventario y la evidencia operativa.

## Diagnóstico de la VM histórica de Parcial 2

Un síntoma clásico: `localhost:3001` responde 200 pero desde fuera hay timeout,
con firewall GCP en verde, SO en ACCEPT y contenedores `Up`. Causa real de
aquella vez: `net.ipv4.ip_forward=0` — el kernel tiraba en silencio todo lo que
necesitaba `FORWARD` (externo→contenedor) sin dejar rastro en ningún contador.
Verificar **antes** de levantar el stack:

```bash
sysctl net.ipv4.ip_forward   # debe ser 1; si es 0:
echo "net.ipv4.ip_forward = 1" | sudo tee /etc/sysctl.d/99-docker-forward.conf
sudo sysctl --system
```

Configuración histórica del monolito: regla GCP con `tcp:3001,tcp:5173` desde `0.0.0.0/0`
(`retail-allow-app`), `VITE_API_URL` igual a la IP externa vigente (cambia al
reiniciar la VM efímera; recrear `web` tras editarla) y `firewalld` con ambos
puertos abiertos. Vía alterna si todo falla: túnel SSH
(`gcloud compute ssh maquina-01 -- -L 3001:localhost:3001 -L 5173:localhost:5173 -N`).

## Notas

- Credenciales hardcodeadas y Redis sin auth a propósito: solo local/dev.
- `postgres_data` se siembra solo con volumen fresco (`schema.sql` + `data_retail.sql`).
- Los `package-lock.json` que aparecen tras un `up` (los contenedores corren
  `npm install`) no se commitean: si `git status` los muestra modificados sin
  haber tocado dependencias, revertirlos.
