# core-process-service — proceso principal + M09 (Sprint 2+3)

Proceso principal (M06 transacciones + importación CSV, M07 canastas) más
M09 analítica descriptiva sobre esos mismos datos. Parte de la plantilla
transversal `services/template-nest`.

## Endpoints (`/v1/`, JSON y XML, SessionGuard)

- **M06**: `POST /v1/transactions` (manual),
  `POST /v1/transactions/import/preview|confirm`,
  `DELETE /v1/transactions/import/:id` (descartar y liberar el archivo),
  `GET /v1/transactions/import/pending`,
  `GET /v1/transactions[?storeId&dateFrom&dateTo&page&limit]`,
  `GET /v1/transactions/:id`.
  Escritura Admin/Analista. Valida contra catalog-service por HTTP
  (caído → 503, sin insertar); reporta a audit-service best-effort.
- **M07**: `GET /v1/baskets[?filtros&page&limit]`, `GET /v1/baskets/:id`,
  `POST /v1/baskets/reclassify[?zoneId]` (masivo, llena huecos),
  `POST /v1/baskets/:id/reclassify[?resyncZone]` (una canasta).
  1:1 con transacción, zona y segmento congelados; segmento por lectura de
  `v_zona_segmento` (RN-02). Nueve filtros combinables con AND.
- **M09**: `average-ticket`, `products-per-basket`, `purchase-frequency`,
  `units-per-transaction`, `spend-by-category`, con los cinco filtros
  aplicados en los cinco indicadores.

Contratos: `docs/contratos/core-process-transactions.md` y
`docs/contratos/core-process-analytics.md`.
XSD por endpoint: `docs/contratos/xsd/core-process/` (incluye `error.xsd`,
porque los errores también salen en XML cuando se piden así).

## Invariantes que el servicio garantiza

- **`total` == Σ `subtotal`.** El total se calcula replicando el redondeo
  por línea de Postgres (`src/transactions/money.util.ts`) y se verifica
  contra la suma real **dentro** de la transacción de base de datos antes
  de confirmar: una transacción incoherente nunca llega a committearse.
  Por eso `quantity` y `unitPrice` admiten máximo 2 decimales.
- **Una transacción = una canasta (RN-03), atómico.** `buildFromTransaction`
  recibe el `EntityManager` de quien la llama y corre en la misma
  transacción de base de datos: nunca queda una venta sin canasta ni una
  canasta sin venta.
- **`productos_basicos <= numero_productos`.** Los dos se cuentan en
  productos DISTINTOS, no en líneas de detalle. Mezclar las unidades viola
  el CHECK de la tabla en cuanto una venta trae dos presentaciones del
  mismo producto básico, y revienta la venta entera.
- **La confirmación de CSV es reanudable.** Solo toma las filas que
  faltan y marca `confirmado` únicamente si no quedó ninguna pendiente:
  una confirmación interrumpida se termina con un segundo `confirm`, sin
  duplicar. Cerrar el estado con filas pendientes las dejaba sin vía de
  recuperación.
- **La forma de la respuesta es el contrato**, no lo que TypeORM cargue:
  las entidades pasan por los mapeadores de `src/common/respuestas.ts`, así
  que no se filtra nada de las tablas de catalog-service y `findAll` y
  `findOne` devuelven exactamente lo mismo.
- **El preview no bloquea el archivo si falla.** La validación contra el
  catálogo corre antes de persistir la cabecera, así que un 503 transitorio
  no deja el hash tomado.
- **El resumen de la confirmación es lo realmente insertado**, con las
  filas rechazadas y los folios omitidos con su motivo.
- **Las bajas lógicas del catálogo se respetan.** Una tienda o una
  presentación con `activo: false` no origina ventas, ni por alta manual
  ni por CSV. Un `activo` ausente cuenta como activo, para no bloquearse
  contra una versión del catálogo que todavía no expone el campo.
- **La zona de la canasta se congela** al construirla (RN-02). Re-derivarla
  desde la tienda es posible pero explícito
  (`POST /v1/baskets/:id/reclassify?resyncZone=true`), porque hacerlo por
  default reescribiría el análisis de meses pasados.
- **Ningún gasto desaparece de `spend-by-category`.** El join a categoría
  es LEFT: un producto sin categoría se agrupa como "Sin categoría" en vez
  de salirse del total con los `share` sumando 100 % sobre menos dinero.
- **Fail-closed en todo**: sin sesión en Redis, sin catálogo o sin secreto
  JWT no se pasa ni se inserta.

## Correr y probar

```bash
npm install
PORT=3104 SERVICE_NAME=core-process-service npm run start:dev

npm test                  # 158 unitarias, sin infraestructura
npm run test:cov          # con cobertura (umbral 85 % statements)
npm run build && npm run xsd   # valida el XML real contra los XSD del contrato
npm run test:integracion  # requiere stack con seed + CSV (VM con Docker)
```

`npm run xsd` necesita `xmllint` (macOS lo trae; en Debian/Ubuntu:
`sudo apt-get install -y libxml2-utils`). No valida ejemplos escritos a
mano: pasa **entidades con sus relaciones eager** por los mapeadores
reales y los cuerpos de error por `serializarErrorXml`, que es la misma
función que usa el filtro. Reconstruir el cuerpo a mano hacía que el gate
pasara en verde mientras el servicio emitía otra cosa.

Si `npm run build` falla con `EACCES` sobre `dist/`: el contenedor monta
este directorio y compila como `root`, así que `dist/` queda del usuario
equivocado en el host. Se arregla con
`sudo chown -R $USER dist` o corriendo dentro del contenedor
(`docker exec retail_core_process_service sh -c 'cd /app && npm run xsd'`).

Las pruebas de integración (`test/`) requieren el stack arriba y
`CORE_TOKEN` con un JWT de Analista o Administrador; si falta alguno de los
dos, fallan con un mensaje que lo dice en vez de un `fetch failed` opaco:

```bash
docker compose -f infra/docker-compose.yml up -d core-process-service
CORE_TOKEN=<jwt> npm run test:integracion

# Con las pruebas de resiliencia, que apagan catalog y audit de verdad:
CORE_TOKEN=<jwt-analista> CORE_TOKEN_ADMIN=<jwt-admin> QA_DOCKER=1 \
  npm run test:integracion
```

Sin `QA_DOCKER=1` las dos pruebas que paran contenedores se omiten en vez
de fallar. `CORE_TOKEN_ADMIN` hace falta para la que da de baja una tienda
en catalog-service (y la restaura al terminar).

`core-process-service` arrastra `postgres` y `redis` sanos vía
`depends_on`; `catalog-service` y `audit-service` hay que levantarlos
aparte si se quieren probar las validaciones y la auditoría de verdad.

Las pruebas de integración son **repetibles sobre una base sucia**: se
generan su propio CSV con folios únicos por corrida, porque una VM de QA
nunca tiene la base limpia y el archivo original ya está importado (su
hash da 409 y sus folios darían `FOLIO_DUPLICADO`).

Si el host ya ocupa 5432 o 6379, el compose de la VM los remapea; apunta
las pruebas al puerto real con `REDIS_PORT`.

## Qué trae resuelto la plantilla

Base de los 9 microservicios NestJS. Ya resuelve lo transversal — **no se
modifica por servicio**, solo se agregan módulos de negocio.

- `GET /v1/health` sin auth, con `checks` de Postgres y Redis; siempre 200
  (`status: degraded` si una dependencia falla), para que el healthcheck de
  Docker pueda distinguir "proceso muerto" de "base caída".
- Error estándar `{ statusCode, message, code, details, path, timestamp }`
  (`src/common/filters/`, catálogo en `services/snippets/error-codes.md`).
  `message` es siempre string, el detalle de validación va en `details`, y
  un 500 inesperado no filtra texto del motor de base de datos al cliente
  pero sí deja su stack en el log.
- Logging JSON por operación con el status real y `x-request-id` de ida y
  de vuelta (`src/common/interceptors/logging.interceptor.ts`).
- XML si `Accept` lo pide — `application/xml`, `text/xml` o `*+xml`,
  respetando q-values —, con prólogo, listas como `<item>` y fechas en ISO
  (`xml.interceptor.ts`). También en los errores.
- `SessionGuard`: JWT + `revoked:{jti}` + `session:{userId}` en Redis
  (`src/common/auth/`). Aplicar con `@UseGuards(SessionGuard)`.
