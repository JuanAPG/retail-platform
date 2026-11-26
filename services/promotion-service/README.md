# promotion-service (puerto 3115) · D-39

Promociones de tres tipos: **descuento porcentual**, **paquete** ("n por $") y **tamaño de
empaque**. Las **propone el Gerente de categoría** y las **aprueba o rechaza el Responsable
de precios**. Calcula el precio unitario regular vs. promocional (MXN por kg, l o pza) y
compara promociones del mismo producto. **No toca el histórico de precios ni la
elasticidad**: aprobar no escribe en `precios`, `elasticidades` ni `analisis_corridas`.

- Contrato (fuente de verdad): [`docs/contratos/promotion-service.md`](../../docs/contratos/promotion-service.md)
  y [`.xsd`](../../docs/contratos/promotion-service.xsd) (namespace `promotion/v1`).
- Decisiones: D-39, D-46, D-06, D-05, D-07/D-08, D-26, D1.
- Base: `services/template-nest/` (correlación, error estándar, XML, `SessionGuard`, health).
  El lector de cuerpos XML sigue la idea de decision-service (`src/common/xml/cuerpo-xml.ts`).

## Rutas

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/promotions` | Gerente de categoría |
| GET | `/v1/promotions` | Los 6 perfiles internos |
| GET | `/v1/promotions/compare?ids=&storeId=` | Los 6 perfiles internos |
| GET | `/v1/promotions/:id` | Los 6 perfiles internos |
| PATCH | `/v1/promotions/:id/approve` | Responsable de precios (ni el Administrador) |
| PATCH | `/v1/promotions/:id/reject` | Responsable de precios |
| GET | `/v1/promotions/:id/unit-price?storeId=` | Los 6 perfiles internos |
| GET | `/v1/health` | Sin autenticación (`health.xsd`) |

Proveedor e Investigador de mercado → `403` en todo. Swagger con ejemplos JSON y XML en
`/docs`.

**Cuerpos XML** (`POST` con raíz `promocionRequest`, `PATCH reject` con
`rechazoPromocionRequest`, namespace `promotion/v1`): los guards corren ANTES de leer el XML
(sin sesión → 401, rol sin permiso → 403); `DOCTYPE`/`ENTITY`, raíz o namespace equivocados
o XML mal formado → 400; más de 1 MB → 413; otro `Content-Type` → 415.

## Cómo calcula (contrato §4)

Precio unitario = precio de compra / contenido base, donde contenido base = contenido ×
`factor_base` de su unidad (catalog `GET /v1/units`). Todo con todos los decimales y se
redondea **solo al final**: importes y porcentajes a 2 decimales, contenidos a 3, mitad hacia
arriba. Caso de control (prueba unitaria `src/promociones/calculo.spec.ts`): arroz 1 kg a $30 →
descuento 10 % = 27.00 MXN/kg (10.00 %), 3 por $80 = 26.67 MXN/kg (11.11 %), 1,200 g por $30 =
25.00 MXN/kg (16.67 %); 1,200 ml → 400.

Al proponer se guardan el contenido, la unidad y el factor de la presentación (y el factor de
`promoUnit`): así `unit-price` y `compare` no dependen de que catalog siga mostrando una
presentación que después se dé de baja.

## Base de datos

Tablas **nuevas** de este servicio, sin llaves foráneas a tablas de otros dueños:
`promociones` y `promocion_eventos` (en `db/schema.sql`, sección 15b).

Una base que ya existía necesita la migración (idempotente):

```bash
docker exec -i retail_postgres psql -U retail_user -d retaildb < db/migraciones/sprint4_promotion.sql
```

## Correr

```bash
npm install
cp .env.example .env     # fuera de Docker: CATALOG_SERVICE_URL=http://localhost:3102, PRICING_SERVICE_URL=http://localhost:3103
npm run build && npm run start:prod
curl -i localhost:3115/v1/health
```

Sin `CATALOG_SERVICE_URL` o `PRICING_SERVICE_URL` el servicio **no arranca** y dice cuál
falta.

## Pruebas

```bash
npm test                  # unitarias: caso de control, tipos, fechas de Monterrey, flujo, XML contra el XSD
npm run test:integracion  # contra el stack local (Postgres con la migración, Redis, auth, catalog, pricing)
```

La integración levanta la app en el proceso y usa sesiones reales de auth-service y datos
reales de catalog y pricing. Si falta un servicio o la migración, **falla** diciendo qué
falta. Escribe en `promociones` / `promocion_eventos` y borra lo que creó al terminar.

## Para Juan Ángel: bloque de `infra/docker-compose.yml`

No se editó `infra/`. Bloque listo para agregar (mismo estilo que pricing-service):

```yaml
  promotion-service:
    image: node:20
    container_name: retail_promotion_service
    working_dir: /app
    volumes:
      - ../services/promotion-service:/app
      - /app/node_modules
    environment:
      PORT: 3115
      SERVICE_NAME: promotion-service
      SERVICE_VERSION: 1.0.0
      # targetNamespace de su XSD: el XmlInterceptor lo pone como
      # xmlns en la raiz para que el XML valide contra docs/contratos/.
      XML_NAMESPACE: promotion/v1
      JWT_ACCESS_SECRET: dev_access_secret_solo_para_local
      REDIS_HOST: redis
      REDIS_PORT: 6379
      BUSINESS_TIMEZONE: America/Monterrey
      AUTH_SERVICE_URL: http://auth-service:3101
      # Lecturas por HTTP (obligatorias): producto, presentacion, unidades, tienda, zona y precio vigente.
      CATALOG_SERVICE_URL: http://catalog-service:3102
      PRICING_SERVICE_URL: http://pricing-service:3103
      # No bloqueantes (1.5 s): auditoria y avisos promocion.propuesta / promocion.resuelta.
      AUDIT_SERVICE_URL: http://audit-service:3110
      NOTIFICATIONS_SERVICE_URL: http://notifications-service:3109
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: retail_user
      DB_PASSWORD: retail_pass_2026
      DB_NAME: retaildb
    ports:
      - "3115:3115"
    command: sh -c "npm install && npm run start:dev"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      catalog-service:
        condition: service_started
      pricing-service:
        condition: service_started
```

También le toca (contrato §14, bloqueante para auditar y avisar): agregar
`promotion-service` a la lista `servicio` de audit-service y a `sourceService` de
notifications-service, agregar los eventos `promocion.propuesta` (destino fijo: rol
Responsable de precios; **no se puede apagar, D-46**) y `promocion.resuelta` (a quien
propuso). Mientras no estén, esas llamadas responden 400: la operación se completa igual y
queda `fallido` en `promocion_eventos` y un `WARN aviso_fallido` en el log.

## Fila de la Matriz §3.2 (para copiar)

| Módulo | Admin | Analista | Gerente | Resp. precios | Planeador | Auditor | Proveedor | Investigador |
|---|---|---|---|---|---|---|---|---|
| Promociones (promotion-service, D-39) | L | L | **P** (+ L) | **A** (+ L) | L | L | – | – |

P y A los fija D-39; las lecturas de los demás perfiles son **PROPUESTA** (contrato §2).
