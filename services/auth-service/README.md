# Plantilla NestJS transversal (Sprint 2+3)

Base de los 9 microservicios NestJS. Ya resuelve lo transversal — **no se
modifica por servicio**, solo se agregan módulos de negocio.

## Qué trae resuelto

- `GET /v1/health` sin auth (`src/health/`)
- Error estándar `{ statusCode, message, code, details, path, timestamp }`
  (`src/common/filters/`, catálogo en `services/snippets/error-codes.md`)
- Logging JSON por operación (`src/common/interceptors/logging.interceptor.ts`)
- XML si `Accept: application/xml` (`xml.interceptor.ts`; XSD en `docs/contratos/`)
- `SessionGuard`: JWT + `revoked:{jti}` + `session:{userId}` en Redis
  (`src/common/auth/`). Aplicar con `@UseGuards(SessionGuard)`.

## Cómo copiarme a un servicio nuevo (5 pasos)

```bash
cp -r services/template-nest services/<nuevo-servicio>
cd services/<nuevo-servicio>
# 1. En .env.example y docker-compose: fija PORT y SERVICE_NAME
# 2. Agrega tus módulos (controladores con rutas que cuelguen de /v1/)
# 3. Protege rutas con @UseGuards(SessionGuard) (health queda abierto)
# 4. Documenta en Swagger con ejemplos JSON y XML
# 5. npm install && npm run build && curl localhost:<PORT>/v1/health
```

## Probarla sola

```bash
npm install
PORT=3000 SERVICE_NAME=plantilla-test npm run start:dev
curl localhost:3000/v1/health
curl localhost:3000/v1/no-existe              # error estándar 404
curl -H 'Accept: application/xml' localhost:3000/v1/health
```
