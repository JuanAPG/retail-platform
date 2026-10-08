# Contrato: catalog-service (Fase A — revisado en equipo antes de clientes)

Base: `http://catalog-service:3102` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`catalog-service.xsd`). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}`. Listados paginados según
`paginacion.md`. Todas las rutas requieren `Authorization: Bearer <accessToken>` y
sesión activa en Redis (`SessionGuard`).

Rutas y campos en **inglés**, igual que `Contrato_Metodos_Endpoints` (Sprint 1).

> Secciones de este contrato, en orden de migración desde el monolito:
> `/v1/segments` · `/v1/zones` y `/v1/municipalities` · `/v1/stores` · `/v1/products` y presentaciones.
> Cada una se agrega al migrarse su módulo.

---

## /v1/segments — Segmentos de ingreso (M05)

Un segmento clasifica **zonas agregadas**, nunca personas ni compras individuales
(RN-02). `source`, `updateFrequency`, `zoneRelation` y `limitations` son obligatorios:
cada segmento debe justificar de dónde sale su rango, cada cuánto se actualiza, cómo
se relaciona con la zona y qué limitaciones tiene.

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/segments` | Los 6 perfiles internos |
| GET | `/v1/segments/:id` | Los 6 perfiles internos |
| POST | `/v1/segments` | Analista comercial |
| PATCH | `/v1/segments/:id` | Analista comercial |
| DELETE | `/v1/segments/:id` | Analista comercial |

El Proveedor no tiene acceso a ninguna ruta de segmentos (`403`).

### Objeto Segment

```json
{
  "id": 1,
  "code": "ING_1",
  "name": "Ingreso bajo",
  "incomeRangeMin": "0.00",
  "incomeRangeMax": "15000.00",
  "source": "INEGI - ENIGH, ingreso corriente trimestral por hogar (AMM)",
  "updateFrequency": "Anual, al publicarse la ENIGH",
  "zoneRelation": "Se asigna a la ZONA agregada (RN-02); nunca a una persona ni compra individual.",
  "limitations": "No captura variación de ingreso dentro de la misma zona.",
  "description": null
}
```

- `incomeRangeMin` / `incomeRangeMax` son **cadenas decimales** (`numeric(12,2)` en
  Postgres, para no perder precisión). `incomeRangeMax: null` = sin tope superior.
- `description` es opcional y puede ser `null`.

### GET /v1/segments

Query: `page`, `limit` (ver `paginacion.md`). Orden fijo: `incomeRangeMin` ascendente
(no "recientes primero"; los segmentos se leen de menor a mayor ingreso).

Response `200`:

```json
{ "data": [ { "id": 1, "code": "ING_1", "…": "…" } ], "total": 5, "page": 1, "limit": 20 }
```

### GET /v1/segments/:id

Response `200`: objeto Segment. Inexistente → `404`.

### POST /v1/segments

Request JSON:

```json
{
  "code": "ING_1",
  "name": "Ingreso bajo",
  "incomeRangeMin": 0,
  "incomeRangeMax": 15000,
  "source": "INEGI - ENIGH, ingreso corriente trimestral por hogar (AMM)",
  "updateFrequency": "Anual, al publicarse la ENIGH",
  "zoneRelation": "Se asigna a la ZONA agregada (RN-02); nunca a una persona ni compra individual.",
  "limitations": "No captura variación de ingreso dentro de la misma zona.",
  "description": "Opcional"
}
```

| Campo | Regla |
|---|---|
| `code` | obligatorio, ≤ 20 caracteres, único |
| `name` | obligatorio, ≤ 60 caracteres, único |
| `incomeRangeMin` | obligatorio, numérico |
| `incomeRangeMax` | opcional, numérico positivo; omitir = sin tope |
| `source`, `zoneRelation`, `limitations` | obligatorios, texto |
| `updateFrequency` | obligatorio, ≤ 60 caracteres |
| `description` | opcional |

Campos no listados → `400` (`forbidNonWhitelisted`). Response `201`: objeto Segment.
`code` o `name` repetido → `409`.

### PATCH /v1/segments/:id

Mismo cuerpo que POST con todos los campos opcionales. Response `200`: objeto
Segment actualizado. Inexistente → `404`; `code`/`name` ya usado por otro → `409`.

### DELETE /v1/segments/:id

Response `204` sin cuerpo. Inexistente → `404`. Si hay zonas clasificadas con el
segmento (`zona_clasificaciones.segmento_manual_id`) → `409`: reclasificarlas antes.

### Códigos de error de esta sección

| Status | Cuándo |
|---|---|
| 400 | Cuerpo inválido, campo desconocido o `:id` no numérico |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso sobre la ruta |
| 404 | Segmento inexistente |
| 409 | `code`/`name` duplicado, o borrado con zonas asociadas |

### Pendiente (no es parte de este contrato todavía)

- Reporte de cambios a auditoría (insert/update/delete) — se define cuando se
  coordine con `audit-service`.

---

## /v1/zones, /v1/municipalities — Zonas y municipios (M03)

La zona guarda solo su **identidad** (nombre, municipio, descripción). Su segmento de
ingreso y sus indicadores cambian con el tiempo y viven en `zona_clasificaciones` e
`indicador_valores`, que calcula Analítica; aquí solo se leen (RN-01, RN-02).

> Las rutas van en inglés. Los **campos** de zonas y tiendas conservan los nombres del
> monolito y del esquema (`nombre`, `zonaId`, `formato`…), porque la web ya los consume.

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/zones` | Los 6 perfiles internos |
| GET | `/v1/zones/compare?ids=` | Los 6 perfiles internos |
| GET | `/v1/zones/:id` | Los 6 perfiles internos |
| POST | `/v1/zones` | Administrador |
| PATCH | `/v1/zones/:id` | Administrador |
| DELETE | `/v1/zones/:id` | Administrador |
| GET | `/v1/municipalities` | Los 6 perfiles internos |

El Proveedor no tiene acceso (`403`). `:id` es UUID; otro valor → `400`.

### Objeto Zone

```json
{
  "id": "f2670df2-94bd-494e-b4ac-04f7e7c02476",
  "nombre": "Zona Centro",
  "municipioId": 2,
  "descripcion": "Centro histórico y comercio tradicional.",
  "activo": true,
  "createdAt": "2026-09-25T19:21:10.262Z",
  "updatedAt": "2026-09-25T19:21:10.262Z",
  "municipio": { "id": 2, "nombre": "Monterrey" }
}
```

### GET /v1/zones

Paginado (`page`, `limit`). Orden fijo: `nombre` ascendente.
Response `200`: `{ "data": [Zone], "total": 3, "page": 1, "limit": 20 }`.

### GET /v1/zones/:id

Response `200`: objeto Zone. Inexistente → `404`.

### POST /v1/zones

```json
{ "nombre": "Zona Norte", "municipioId": 2, "descripcion": "Opcional" }
```

| Campo | Regla |
|---|---|
| `nombre` | obligatorio, ≤ 120 caracteres |
| `municipioId` | obligatorio, entero positivo de un municipio existente (si no → `400`) |
| `descripcion` | opcional |

Response `201`: objeto Zone (nace `activo: true`). Mismo `nombre` en el mismo municipio → `409`.

### PATCH /v1/zones/:id

Mismos campos, todos opcionales, más `activo` (boolean) para desactivar sin borrar.
Response `200`: Zone actualizada. `404` / `400` / `409` como en POST.

### DELETE /v1/zones/:id

Response `204`. Inexistente → `404`. Con tiendas u otros registros asociados → `409`
(desactivar con `PATCH {activo:false}` en lugar de borrar).

### GET /v1/zones/compare?ids=uuid1,uuid2

Compara zonas por su clasificación vigente e indicadores más recientes. Es de **solo
lectura**: no calcula nada, lee lo que Analítica ya calculó. **No se pagina**
(cálculo al vuelo acotado por los `ids` que manda el cliente; excepción declarada en
`paginacion.md`).

Response `200` (arreglo plano):

```json
[
  {
    "zoneId": "97925ca4-3845-4e68-9660-46f781957b8c",
    "zoneName": "Zona Valle",
    "municipality": "San Pedro Garza García",
    "classification": "Ingreso alto",
    "estimatedIncome": null,
    "population": null,
    "availability": null
  }
]
```

`classification`, `estimatedIncome`, `population` y `availability` son `null` mientras no
exista clasificación vigente o el indicador no se haya calculado. Sin `ids` → `400`;
ninguna zona existente → `404`.

### GET /v1/municipalities

Catálogo chico e inmutable en la práctica: **arreglo plano, sin paginar**
(excepción declarada en `paginacion.md`), ordenado por `nombre`.

```json
[ { "id": 3, "nombre": "Guadalupe" }, { "id": 2, "nombre": "Monterrey" } ]
```

---

## /v1/stores — Tiendas (M02)

Una tienda nace siempre **con su dirección** (se crean en una sola transacción).

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/stores` | Los 6 perfiles internos |
| GET | `/v1/stores/catalog/postal-codes` | Los 6 perfiles internos |
| GET | `/v1/stores/:id` | Los 6 perfiles internos |
| POST | `/v1/stores` | Administrador |
| PATCH | `/v1/stores/:id` | Administrador |
| DELETE | `/v1/stores/:id` | Administrador |

El Proveedor no tiene acceso (`403`). `:id` es UUID; otro valor → `400`.

### Objeto Store

```json
{
  "id": "27f05c81-c6bf-456a-a273-150e4edb9900",
  "nombre": "Abarrotes Constitución",
  "formato": "minimarket",
  "numeroSucursal": "SUC-002",
  "activo": true,
  "direccionId": "65abaa34-…",
  "zonaId": "f2670df2-…",
  "proveedorId": null,
  "createdAt": "2026-09-25T19:21:10.262Z",
  "updatedAt": "2026-09-29T17:23:03.947Z",
  "direccion": {
    "id": "65abaa34-…", "calle": "Av. Constitución", "numeroExterior": "1050",
    "numeroInterior": null, "colonia": "Centro", "codigoPostal": "64000",
    "referencia": null, "latitud": null, "longitud": null,
    "codigoPostalRef": {
      "codigoPostal": "64000", "municipioId": 2,
      "municipio": { "id": 2, "nombre": "Monterrey" }
    }
  },
  "zona": { "…": "objeto Zone" },
  "proveedor": null
}
```

- `formato`: `supermercado | minimarket | tienda_conveniencia | mayorista | otro`.
- `proveedor` es `null` o el registro de `proveedores` (`id`, `razonSocial`, `rfc`,
  `contactoNombre`, `email`, `telefono`, `activo`, fechas). Ese catálogo es de
  `auth-service`; aquí solo se **lee**.
- `latitud` / `longitud` son cadenas decimales (`numeric(9,6)`) o `null`.

### GET /v1/stores

Paginado (`page`, `limit`). Orden fijo: `nombre` ascendente.
Response `200`: `{ "data": [Store], "total": n, "page": 1, "limit": 20 }`.

### GET /v1/stores/catalog/postal-codes

Catálogo de códigos postales válidos para el formulario de alta. **Arreglo plano, sin
paginar**, ordenado por `codigoPostal`:

```json
[ { "codigoPostal": "64000", "municipioId": 2, "municipio": { "id": 2, "nombre": "Monterrey" } } ]
```

### GET /v1/stores/:id

Response `200`: objeto Store. Inexistente → `404`.

### POST /v1/stores

```json
{
  "nombre": "Super Valle Norte",
  "formato": "supermercado",
  "zonaId": "uuid-de-zona",
  "numeroSucursal": "SUC-004",
  "proveedorId": "uuid-opcional",
  "calle": "Av. Insurgentes",
  "numeroExterior": "1200",
  "numeroInterior": "B",
  "colonia": "Del Valle",
  "codigoPostal": "66220"
}
```

| Campo | Regla |
|---|---|
| `nombre` | obligatorio, ≤ 150 |
| `formato` | obligatorio, uno de los 5 valores |
| `zonaId` | obligatorio, UUID de una zona existente (si no → `400`) |
| `calle` | obligatoria, ≤ 150 |
| `codigoPostal` | obligatorio, ≤ 10, debe existir en el catálogo (si no → `400`) |
| `numeroSucursal` | opcional, ≤ 20 |
| `proveedorId` | opcional, UUID |
| `numeroExterior`, `numeroInterior` | opcionales, ≤ 20 |
| `colonia` | opcional, ≤ 120 |

Response `201`: objeto Store (nace `activo: true`).

### PATCH /v1/stores/:id

Mismos campos, todos opcionales, más `activo` (boolean). Si viene algún campo de
dirección se actualiza la dirección de la tienda (es exclusiva de ella). Response
`200`: Store actualizada. `zonaId` o `codigoPostal` inexistentes → `400`.

### DELETE /v1/stores/:id

Inexistente → `404`. **Nunca se pierde el historial (D-07):**

- Sin precios, inventario ni transacciones: se borra (con su dirección, que es
  exclusiva de la tienda) y responde `204` sin cuerpo.
- Con alguno de ellos: **no se borra**; queda `activo = false`, sale de
  `GET /v1/stores` y responde `200` con la Store ya inactiva. Sus precios siguen en
  el historial.

### Códigos de error de zonas y tiendas

| Status | Cuándo |
|---|---|
| 400 | Cuerpo inválido, campo desconocido, `:id` no UUID, zona/municipio/código postal inexistente, `compare` sin `ids` |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso sobre la ruta |
| 404 | Zona o tienda inexistente; `compare` sin ninguna zona existente |
| 409 | Zona duplicada en el municipio; borrado con registros asociados |

---

## /v1/products, /v1/presentations, catálogos de producto (M04)

Precios, inventario y líneas de venta cuelgan de la **PRESENTACIÓN**, nunca del
producto (RF-35). Un producto se da de alta siempre **con su primera presentación**
(una sin la otra no se puede cotizar ni vender).

### Rutas

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/product-categories` | Cualquier usuario autenticado |
| GET | `/v1/units` | Cualquier usuario autenticado |
| GET | `/v1/providers` | Administrador, Analista comercial, Gerente de categoría, Auditor |
| GET | `/v1/products` | Los 7 perfiles (**el Proveedor solo ve los suyos**) |
| GET | `/v1/products/pending` | Gerente de categoría, Administrador (solo lectura), Auditor (solo lectura) |
| GET | `/v1/products/:id` | Los 6 perfiles internos |
| POST | `/v1/products` | Gerente de categoría |
| POST | `/v1/products/proposals` | Proveedor |
| PATCH | `/v1/products/:id` | Gerente de categoría |
| DELETE | `/v1/products/:id` | Gerente de categoría |
| PATCH | `/v1/products/:id/approve` | Gerente de categoría |
| PATCH | `/v1/products/:id/reject` | Gerente de categoría |
| GET | `/v1/products/:id/presentations` | Los 6 perfiles internos |
| POST | `/v1/products/:id/presentations` | Gerente de categoría |
| DELETE | `/v1/presentations/:id` | Gerente de categoría |

`:id` es UUID; otro valor → `400`. Los perfiles de consulta (Auditor, Analista,
Planeador) no tienen ninguna ruta de escritura sobre productos.

### Objeto Product

```json
{
  "id": "uuid",
  "sku": "ABA-ARR-001",
  "nombre": "Arroz blanco 1 kg",
  "descripcion": null,
  "categoriaId": 1,
  "esCanastaBasica": true,
  "estatus": "activo",
  "proveedorId": null,
  "createdAt": "2026-09-25T19:21:10.262Z",
  "updatedAt": "2026-09-25T19:21:10.262Z",
  "categoria": { "id": 1, "nombre": "Abarrotes", "categoriaPadreId": null, "descripcion": null },
  "proveedor": null,
  "presentaciones": [ { "…": "objeto Presentation" } ]
}
```

- `estatus`: `pendiente_aprobacion | activo | rechazado | inactivo`.
- `proveedor` es `null` (alta directa) o el registro de `proveedores` (ver Store). Es de
  `auth-service`; aquí solo se **lee**.
- El **motivo de rechazo no viaja en el producto**: queda en el historial de revisiones
  (`producto_revisiones`). Pendiente decidir cómo lo consulta el Proveedor.

### Objeto Presentation

```json
{
  "id": "uuid",
  "productoId": "uuid",
  "nombre": "1 kg",
  "contenido": "1.000",
  "unidadMedidaId": 1,
  "codigoBarras": null,
  "esPredeterminada": true,
  "activo": true,
  "createdAt": "…",
  "updatedAt": "…",
  "unidadMedida": { "id": 1, "clave": "kg", "nombre": "Kilogramo", "tipo": "masa", "factorBase": "1.000000" }
}
```

`contenido` y `factorBase` son **cadenas decimales** (para no perder precisión).

### Catálogos

- `GET /v1/product-categories` → arreglo plano ordenado por `nombre`:
  `[{ "id", "nombre", "categoriaPadreId", "descripcion" }]`.
- `GET /v1/units` → arreglo plano ordenado por `clave`:
  `[{ "id", "clave", "nombre", "tipo", "factorBase" }]`.
  Ambos son catálogos chicos e inmutables en la práctica: **sin paginar**
  (excepción declarada en `paginacion.md`). Los lee también el Proveedor, que los
  necesita para proponer.
- `GET /v1/providers` → **paginado**, orden `razonSocial` ascendente; cada elemento es
  un Supplier (`id`, `razonSocial`, `rfc`, `contactoNombre`, `email`, `telefono`,
  `activo`, `createdAt`, `updatedAt`).

### GET /v1/products

Paginado (`page`, `limit`), orden fijo `nombre` ascendente.
Response `200`: `{ "data": [Product], "total": n, "page": 1, "limit": 20 }`.

**El recorte por dueño del dato se hace en la consulta**, no en el cliente: un
Proveedor recibe únicamente los productos de su empresa (vínculo por correo:
`usuarios.email` = `proveedores.email`, ambos únicos); los perfiles internos ven el
productos **activos** (D-08: un producto pendiente o rechazado no existe para el resto
del equipo hasta que se aprueba; core-process y pricing lo validan con este mismo
catálogo). Un Proveedor sin empresa vinculada → `403`.

### GET /v1/products/pending

Bandeja de propuestas por revisar. Paginado, orden fijo `createdAt` **ascendente**
(las más antiguas primero: es una cola de trabajo). Solo `estatus =
pendiente_aprobacion`. La resuelve el Gerente de categoría; Administrador y Auditor la
leen.

### GET /v1/products/:id

Response `200`: Product con sus presentaciones. Inexistente → `404`. Un producto que no
está `activo` solo lo ve el Gerente, el Administrador y el Auditor; para los demás
perfiles internos responde `404` (D-08).

### POST /v1/products — alta directa

Nace `activo` y sin proveedor. Pensada para Administrador/Gerente; aquí sí se puede
marcar `esCanastaBasica` (clasificación de negocio, RN-04).

```json
{
  "sku": "ABA-ARR-001",
  "nombre": "Arroz blanco 1 kg",
  "descripcion": "Opcional",
  "categoriaId": 1,
  "esCanastaBasica": true,
  "presentacion": "1 kg",
  "contenido": 1,
  "unidadMedida": "kg"
}
```

| Campo | Regla |
|---|---|
| `sku` | obligatorio, ≤ 40, único (`409` si existe) |
| `nombre` | obligatorio, ≤ 150 |
| `categoriaId` | obligatorio, entero positivo de una categoría existente (si no → `400`) |
| `presentacion` | obligatorio, ≤ 60 (nombre de la primera presentación) |
| `contenido` | obligatorio, numérico mayor a 0 |
| `unidadMedida` | obligatorio, ≤ 10, **clave** del catálogo (`kg`, `g`, `l`, `ml`, `pza`…); inexistente → `400` |
| `descripcion`, `esCanastaBasica` | opcionales |

Response `201`: Product con su presentación (marcada `esPredeterminada: true`).
Producto y presentación se crean en una sola transacción.

### POST /v1/products/proposals — propuesta del Proveedor

Mismo cuerpo que el alta directa **sin `esCanastaBasica`**. El servidor fija lo que
el proveedor no decide: `proveedorId` sale del token, `estatus` es
`pendiente_aprobacion` y `esCanastaBasica` es `false`. Mandar `proveedorId`,
`estatus` o `esCanastaBasica` → `400` (campo no permitido).

Response `201`: Product pendiente. Empresa proveedora inactiva → `403`; cuenta sin
empresa vinculada → `403`; `sku` repetido → `409`.

### PATCH /v1/products/:id

Cuerpo (todos opcionales): `nombre`, `descripcion`, `categoriaId`, `esCanastaBasica`.
**No acepta `estatus`**: solo cambia por `approve` / `reject`, para que toda decisión
quede en `producto_revisiones`. Response `200`: Product actualizado.

### DELETE /v1/products/:id

Inexistente → `404`. **Nunca se pierde el historial (D-07):**

- Si ninguna presentación tiene precios, inventario, ventas ni propuestas de precio: se
  borra con sus presentaciones y responde `204` sin cuerpo.
- Si alguna lo tiene: **no se borra**; el producto queda `estatus = inactivo`, sus
  presentaciones `activo = false`, y responde `200` con el Product. Los precios siguen
  en el historial.

### PATCH /v1/products/:id/approve

Sin cuerpo. Pasa el producto a `activo` y registra quién lo resolvió y cuándo.
Response `200`: Product. Solo se resuelve lo `pendiente_aprobacion`; una propuesta ya
resuelta → `409` (para que dos revisores no se sobrescriban).

### PATCH /v1/products/:id/reject

```json
{ "motivoRechazo": "La ficha técnica no acredita el certificado orgánico." }
```

`motivoRechazo`: obligatorio, mínimo 10 caracteres. Pasa el producto a `rechazado` y
guarda motivo, revisor y fecha. Response `200`: Product. Ya resuelta → `409`.

### GET /v1/products/:id/presentations

Arreglo plano de Presentation activas (las de un solo producto; **sin paginar**), orden
`nombre`. Producto inexistente → `404`.

### POST /v1/products/:id/presentations

```json
{ "nombre": "500 g", "contenido": 500, "unidadMedida": "g", "codigoBarras": "7501234567890", "esPredeterminada": false }
```

`nombre` obligatorio ≤ 60; `contenido` numérico > 0; `unidadMedida` clave existente;
`codigoBarras` opcional ≤ 20; `esPredeterminada` opcional (default `false`).
Response `201`: Presentation. Producto inexistente → `404`; unidad inexistente → `400`.
Como **solo puede haber una presentación predeterminada por producto**, marcar
`esPredeterminada: true` cuando ya existe otra → `409`.

### DELETE /v1/presentations/:id

Inexistente → `404`. **Nunca se pierde el historial (D-07):** sin precios, inventario,
ventas ni propuestas de precio se borra (`204`); con alguno de ellos queda
`activo = false`, sale de `GET /v1/products/:id/presentations` y responde `200` con la
Presentation.

### Códigos de error de esta sección

| Status | Cuándo |
|---|---|
| 400 | Cuerpo inválido, campo no permitido, `:id` no UUID, categoría o unidad inexistente |
| 401 | Sin token, token revocado o sin sesión en Redis |
| 403 | Rol sin permiso; empresa proveedora inactiva o no vinculada |
| 404 | Producto o presentación inexistente |
| 409 | SKU duplicado; propuesta ya resuelta; segunda presentación predeterminada |

---

## Caché (Redis)

Los **cuatro catálogos planos** se cachean en Redis (prefijo `catalog:`, TTL **1 hora**), porque cada
pantalla y la app móvil los piden para llenar listas y casi nunca cambian:

| Ruta | Llave |
|---|---|
| `GET /v1/product-categories` | `catalog:categories` |
| `GET /v1/units` | `catalog:units` |
| `GET /v1/municipalities` | `catalog:municipalities` |
| `GET /v1/stores/catalog/postal-codes` | `catalog:postal-codes` |

- Son de **solo lectura** en este servicio (ninguna ruta los modifica), así que no hay invalidación al
  escribir: un cambio manual en la base se ve al caducar el TTL (o borrando la llave).
- **No** se cachean zonas, tiendas, productos, presentaciones ni segmentos: cambian con las escrituras
  del propio servicio y se paginan/filtran.
- La caché **no se salta la seguridad**: el token, la sesión en Redis y el rol se validan antes que la caché.
- Si Redis no responde o el valor guardado está corrupto, el servicio responde desde Postgres como si no
  hubiera caché. El cuerpo (JSON o XML) es el mismo con o sin caché.
- Otros servicios deben pedir estos catálogos por la API, no leer las llaves de Redis directamente.
