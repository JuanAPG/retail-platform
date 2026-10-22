# Plantilla NestJS transversal

Base de los microservicios NestJS (los 9 del Parcial 2 y los nuevos del Sprint 4). Ya
resuelve lo transversal — **no se modifica por servicio**, solo se agregan módulos de
negocio.

## Qué trae resuelto

- `GET /v1/health` sin auth, con `postgres`, `mongodb` y `redis`, lo que tardó cada uno
  (`latencyMs`) y el total (`durationMs`). Esquema: `docs/contratos/health.xsd`
  (`src/health/`).
- **Id de correlación** `X-Correlation-Id` (T-02): se toma de la petición o se genera, se
  devuelve en la respuesta, va en cada línea de log y en el log de errores, y se reenvía
  a otros servicios con `conCorrelacion()` (`src/common/correlation/`).
- Error estándar `{ statusCode, message, code, details, path, timestamp }`
  (`src/common/filters/`, catálogo en `services/snippets/error-codes.md`)
- Logging JSON por operación (`src/common/interceptors/logging.interceptor.ts`)
- XML si `Accept: application/xml` (`xml.interceptor.ts`; XSD en `docs/contratos/`)
- `SessionGuard`: JWT + `revoked:{jti}` + `session:{userId}` en Redis
  (`src/common/auth/`). Aplicar con `@UseGuards(SessionGuard)`.

## Crear un servicio nuevo (8 pasos)

Antes: el contrato `docs/contratos/<servicio>.md` + `.xsd` revisado y la fila de
permisos en la Matriz §3.2 (ver `CONTRIBUTING.md`).

```bash
# 1. Copia la plantilla (sin node_modules ni dist)
cp -r services/template-nest services/<servicio> && rm -rf services/<servicio>/{node_modules,dist}
cd services/<servicio>
# 2. package.json: cambia "name" y "description"
# 3. .env.example y el bloque en infra/docker-compose.yml: PORT (3111–3120),
#    SERVICE_NAME y XML_NAMESPACE (el targetNamespace de tu XSD)
```

4. **Dependencias que uses:** Postgres → `@nestjs/typeorm` + `typeorm` + `pg` (copia
   `TypeOrmModule.forRootAsync` de un servicio existente, `synchronize: false`); Mongo →
   `@nestjs/mongoose` + `mongoose` (`bufferCommands: false`, ver notifications-service).
5. **Health:** en `src/health/health.controller.ts` cambia `sinConfigurar` por
   `() => verificarPostgres(this.dataSource)` y/o `() => verificarMongo(this.conexion)`.
6. **Módulos de negocio:** controladores bajo `/v1/`, `@UseGuards(SessionGuard, RolesGuard)`
   con los roles de la Matriz (constante `ROL`), `@XmlRoot(...)` con la raíz de tu XSD y
   Swagger con ejemplo JSON y XML.
7. **Llamadas a otros servicios** (audit, notifications, los que consumas):
   `fetch(url, { headers: conCorrelacion({ Authorization: token }) })`, con timeout corto;
   audit y notifications sin bloquear.
8. **Verifica:** `npm install && npm test && npm run build`, luego
   `docker compose -f infra/docker-compose.yml up -d <servicio>` y
   `curl -i localhost:<PORT>/v1/health` (debe traer `X-Correlation-Id`).

## Probarla sola

```bash
npm install
PORT=3000 SERVICE_NAME=plantilla-test npm run start:dev
curl -i localhost:3000/v1/health                                   # trae X-Correlation-Id
curl -H 'X-Correlation-Id: demo-1' -i localhost:3000/v1/no-existe   # error estándar 404, mismo id
curl -H 'Accept: application/xml' localhost:3000/v1/health
```
