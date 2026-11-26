# transactions-ingestion-service (3111)

Contrato para revisión de T-04 y T-08 · D-33 y D-34 · Plantilla `template-nest`.
Las rutas de esta página son nuevas. Core conserva temporalmente sus rutas
`/v1/transactions/import/*` hasta validar el cambio en web y escritorio.

## Rutas y permisos

Requieren JWT y sesión activa en Redis. El Analista comercial crea,
confirma y descarta sus lotes. En las consultas puede ver sus propios lotes
y el Administrador puede ver todos, siguiendo el acceso de lectura del legado.
Un lote ajeno para un Analista se trata como inexistente (404). Los demás
roles reciben 403. El servicio retorna `X-Correlation-Id` y lo propaga a
core-process, auditoría, notificaciones y gobierno de datos.

| Método y ruta | Éxito | Cuerpo |
|---|---:|---|
| `POST /v1/transaction-imports` | 201 | Multipart con una parte binaria `file` para CSV, JSON o XML. |
| `POST /v1/transaction-imports/from-object` | 201 | Referencia JSON o XML a una generación inmutable del bucket privado. |
| `GET /v1/transaction-imports?state=&page=&limit=` | 200 | Lista paginada de lotes, incluido el historial. |
| `GET /v1/transaction-imports/{id}` | 200 | Resumen del lote, UUID v4. |
| `GET /v1/transaction-imports/{id}/rows?page=&limit=` | 200 | Filas con resultado y errores. |
| `POST /v1/transaction-imports/{id}/confirm` | 200 | Sin cuerpo. Repetir devuelve el resultado persistido o continúa las filas pendientes. |
| `DELETE /v1/transaction-imports/{id}` | 200 | Resumen en estado `descartado`. Antes de confirmar. |
| `GET /v1/health` | 200 | Estado ampliado de dependencias. Sin sesión. |

Las respuestas se negocian mediante `Accept` (`application/json` o
`application/xml`). Paginación según [contrato transversal](paginacion.md).
Las fechas del archivo representan un día en `America/Monterrey` y
`createdAt` un instante ISO 8601. Los importes son MXN y la cantidad
corresponde a la unidad de la presentación. Cantidad y precio son positivos
con hasta dos decimales.

## Archivos, ejemplo y confirmación

El servidor identifica el formato por contenido y comprueba el tipo
declarado. Propuesta de límites configurables `INGESTION_MAX_BYTES=8388608`
y `INGESTION_MAX_ROWS=10000`. Se cuenta cada línea lógica de datos sin
encabezado. Se exige UTF-8 y se rechazan DTD y entidades externas antes de
validar el XML. El SHA-256 se calcula con los bytes originales. Se guarda
el objeto privado, su tamaño, formato, generación y hash. El nombre original
se conserva en los metadatos y la clave del objeto la elige el servicio.

CSV acepta coma o punto y coma, y conserva las columnas del legado.

```csv
folio,fecha,tienda,sku,presentacion,cantidad,precio
DEMO-001,2026-11-20,MTY-CENTRO,SKU-100,500 g,2,42.50
```

JSON expresa el mismo archivo como
`{"rows":[{"folio":"DEMO-001","fecha":"2026-11-20","tienda":"MTY-CENTRO","sku":"SKU-100","presentacion":"500 g","cantidad":2,"precio":42.50}]}`.
El XML equivalente está en [ejemplos XML](ejemplos/ingestion-ventas.xml).
`tienda`, `sku` y `presentacion` identifican las referencias del catálogo
igual que en la importación CSV existente.

Una referencia envía `{"objectKey":"ingestion/incoming/01/demo.csv","generation":"1764000000000000"}`
o [su equivalente XML](ejemplos/ingestion-objeto.xml). La generación viaja
como cadena. El bucket proviene de `GCS_INGESTION_BUCKET`, el prefijo de
`GCS_INGESTION_INCOMING_PREFIX` y el acceso depende de la carga registrada
para el actor. La API recibe claves del prefijo configurado.

Una vista previa devuelve 201 con un resumen como el siguiente.

```json
{"id":"05dbdf5a-8342-4d61-bfce-e04e2b644f9b","state":"vista_previa","format":"csv","sha256":"e3f81957d04502d6fcb9eb53e98957e56ba9d17a350ff7fa74c409e0209ef451d","sizeBytes":124,"createdAt":"2026-11-23T19:00:00Z","counts":{"valid":1,"repeated":0,"rejected":1,"conflicts":0,"inserted":0}}
```

Un rechazo por fila aparece como
`{"row":2,"status":"rechazada","code":"PRECIO_INVALIDO","message":"El precio debe ser mayor que cero."}`.
`row` empieza en 1 para la primera fila de datos. La vista previa no crea
ventas. Los estados son `vista_previa`, `confirmando`, `conciliacion`,
`confirmado` y `descartado`. `conciliacion` identifica un lote con filas
en conflicto que requiere revisión. Los primeros cuatro contadores
clasifican las filas del archivo. `inserted` cuenta las ventas nuevas.

Tienda y folio identifican la venta. Al confirmar, ingestion transmite
cada venta válida a core-process por HTTP. El destino distingue contenido
igual (repetido) de contenido distinto para la misma clave (conflicto).
El acuse se guarda por venta y la reanudación repite solo las pendientes.
La clave y la comparación en destino también cubren un timeout después del
commit. El aviso de finalización y el registro de linaje comparten el ID de
correlación. La ruta interna y el contrato de acuse con core deben
validarse antes de retirar el camino legado.

Errores de petición en el formato estándar (`statusCode`, `message`,
`code`, `details?`, `path`, `timestamp`). 400 para estructura inválida,
401/403/404 para acceso, 409 para una transición incompatible, 413 para
límites, 415 para formato ajeno, 422 para contenido inválido y 503 para
dependencia no disponible. El [XSD](transactions-ingestion-service.xsd)
define los cuerpos negociados, incluidos los de rechazo.

Pendiente de confirmación con Pamela para referencia de objeto, con
Fernando para resultados por fila y con Leonardo para linaje y lecturas de
ventas y canastas por zona, producto y semana.
