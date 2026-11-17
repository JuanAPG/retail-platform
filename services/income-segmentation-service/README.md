# income-segmentation-service (3112)

Segmentos de ingreso **versionados** y clasificación de zonas (T-10, Sprint 4).
Responsable: Pamela Rodríguez. Parte de `services/template-nest/` (T-02).

- Contrato: [`docs/contratos/income-segmentation-service.md`](../../docs/contratos/income-segmentation-service.md)
  y su XSD (namespace `segmentation/v1`).
- Decisiones: **D-35** (los segmentos y la clasificación salen de catalog-service; cada
  cambio crea una versión), **D-10** (rangos encimados → 400), **D-36** (mínimo de datos
  para publicar un agregado).
- Permisos (Matriz §3.2, igual que M05): escribe el **Analista comercial**; leen los 6
  perfiles internos; Proveedor e Investigador de mercado → 403.

## Qué hace

| Ruta | Para qué |
|---|---|
| `GET/POST/PATCH/DELETE /v1/segments` | Segmentos. `PATCH` no edita: **anexa la versión n + 1** y conserva la anterior |
| `GET /v1/segments/:id/versions[/:version]` | Historial de versiones, con fuente, fecha, autor y motivo |
| `PUT /v1/zones/:zoneId/classification` | Clasifica una zona y guarda **con qué versión** del segmento |
| `GET /v1/zones/:zoneId/classification[/history]` | Clasificación vigente e historial de la zona |
| `GET /v1/zone-classifications?asOf=YYYY-MM-DD` | Qué clasificación valía un día dado |
| `GET /v1/publication/zone-segments` | Qué combinaciones zona-segmento tienen datos suficientes (D-36) |
| `GET /v1/health` | Salud con Postgres y Redis (sin sesión) |

El segmento es de la **zona agregada**: nunca se guarda ni se infiere el ingreso de una
persona o de una compra (RN-02).

## Datos

Postgres compartido. Este servicio es el único que escribe:

- `segmentos_ingreso`: identidad y valores **vigentes** (quien ya la leía no cambia).
- `segmento_versiones` (nueva): una fila por versión; solo se anexa.
- `zona_clasificaciones`: historial por zona, con `segmento_version`.

Lee además `corrida_clusters` (parte del modelo de clasificación) para mostrar las
clasificaciones por cluster que ya existan. No usa MongoDB. Redis solo para la sesión.

Una base creada **antes** de este servicio se actualiza sin perder datos con:

```bash
docker exec -i retail_postgres psql -U retail_user -d retaildb \
  < db/migraciones/sprint4_income_segmentation.sql
```

## Otros servicios (por HTTP, con el token y el `X-Correlation-Id` de quien llama)

| Servicio | Para qué | Si no responde en 3 s |
|---|---|---|
| catalog-service | Validar la zona al clasificar; tiendas por zona (D-36) | `503` |
| core-process-service | Conteo de transacciones y ticket promedio por zona (D-36) | `503` |
| audit-service | Bitácora de altas, versiones, bajas y clasificaciones | Se ignora: la operación se completa |

## Levantarlo

```bash
docker compose -f infra/docker-compose.yml up -d income-segmentation-service
curl -i localhost:3112/v1/health        # trae X-Correlation-Id
```

Swagger: <http://localhost:3112/docs> (ejemplos JSON y XML). Variables en `.env.example`.

## Pruebas

```bash
npm test                 # unitarias: rangos (D-10), versiones (D-35), publicación (D-36)
npm run test:integracion # contra el stack real; valida el XML contra el XSD
```

Las de integración necesitan `postgres redis catalog-service core-process-service
income-segmentation-service` arriba con el seed, y Python con `lxml` para validar el XSD
(sin él, esa validación se salta con un aviso). Crean un segmento `ING_IT` y una zona de
prueba, y borran lo que crean.

## Pendientes y avisos

- **P-11 (pendiente del Product Owner):** D-36 no dice qué pasa cuando solo se cumple uno
  de los dos umbrales (10 transacciones, 3 tiendas). Lo decide `PUBLICATION_RULE`:
  `ambos` (por defecto: no publica) o `cualquiera`. Al cerrarse P-11 se cambia la
  variable, no el código.
- **audit-service todavía rechaza a este servicio:** su catálogo de `servicio` solo admite
  los 10 del Parcial 2, así que responde `400` a los eventos de
  `income-segmentation-service` y no quedan en la bitácora. Aquí no rompe nada (el reporte
  no bloquea), pero hay que agregar el nombre en audit-service (Juan Angel).
- **Transición de D-35:** catalog-service aún expone `/v1/segments` y
  `PUT /v1/zones/:id/classification`. Mientras no se retiren, un segmento editado allá no
  genera versión. La web y el escritorio deben apuntar aquí.
- **Lecturas por SQL de otros servicios** (decision, algorithms-core, core-process) sobre
  `segmentos_ingreso` y `zona_clasificaciones` siguen funcionando: las columnas que usan
  no cambiaron. Deben migrar a HTTP.
