# monitoring-service (3120)

API de T-09 para los 20 servicios. Consulta el
[contrato JSON/XML](../../docs/contratos/monitoring-service.md) y D-44/D-47.

```bash
docker compose -f infra/docker-compose.yml up -d --build monitoring-service
curl -fsS http://localhost:3120/v1/health
```

Una instancia de monitor sondea los 20 destinos cada 30 s, incluido
su propio proceso. Por defecto usa el DNS de Compose, excepto para sí
misma. `MONITOR_TARGETS` permite sustituir orígenes por ambiente, por
ejemplo `{"auth-service":"http://127.0.0.1:3101"}`. El monitor añade
`/v1/health`. Configura los valores de [.env.example](.env.example)
y los secretos de Redis, Mongo y JWT por ambiente.

El monitor guarda la colección `monitoreo_sondeos` con un índice TTL de
24 horas en MongoDB. Las consultas también filtran a ese intervalo.
Conserva el último ciclo en memoria y Redis, e intenta restaurarlo de
Redis o MongoDB al reiniciar. Si Redis no permite validar la sesión,
las rutas del panel devuelven 503. El ciclo sigue sondeando y guarda
historial si MongoDB está disponible.

```bash
npm ci
npm run build
npm test -- --runInBand
MONITOR_ADMIN_TOKEN=<token> MONITOR_ANALYST_TOKEN=<token> python3 test/integration.py
```

La integración requiere Python con lxml y tokens de cuentas sintéticas en
el mismo Redis. Valida los permisos, el sondeo del propio proceso, los
20 puertos, el historial MongoDB y XML. El servicio distingue errores de
sondeo de errores de negocio, que se consultan en los logs de cada API.
