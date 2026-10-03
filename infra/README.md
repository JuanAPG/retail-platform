# Infraestructura local y VM de demo

## Levantar el stack

```bash
docker compose -f infra/docker-compose.yml up -d postgres pgadmin api web redis
docker compose -f infra/docker-compose.yml logs -f api
```

Front en `http://localhost:5173`, API/Swagger en `http://localhost:3001/docs`,
microservicios nuevos en `3101–3110` (`/v1/health` en cada uno).

## Checklist de VM nueva (lección del 02-oct-2026)

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

Resto del checklist: regla GCP con `tcp:3001,tcp:5173` desde `0.0.0.0/0`
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
