# Contrato: offline-sync-service (T-07 · Sprint 4)

Base: `http://offline-sync-service:3118` · Todas las rutas cuelgan de `/v1/`.
Responde JSON por defecto y XML si `Accept: application/xml` (XSD en
`offline-sync-service.xsd`, namespace `sync/v1`). **Recibe** el lote en JSON
(`Content-Type: application/json`, app móvil) o en XML (`Content-Type: application/xml`,
raíz `loteSync`, app de escritorio). Errores con el cuerpo estándar
`{statusCode, message, code, details, path, timestamp}` y los códigos de
`services/snippets/error-codes.md`. Listados paginados según `paginacion.md`.

Plantilla: `services/template-nest/` (con T-02: `X-Correlation-Id` y health con
dependencias). `GET /v1/health` sigue `health.xsd`.

Decisiones que aplica: **D-42** (id de captura generado en el dispositivo, conflicto,
acuse por captura), **D-47** (lotes en MongoDB; idempotencia y último estado en Redis),
**D-28** (el `Investigador de mercado` es el usuario de la app móvil), **D-31** (roles del
escritorio), **D-25** (almacén caído → 503), **D-26** (solo ids de usuario) y **D-43**
(capturas de campo se retienen 1 año).

> **Todo lo marcado PROPUESTA** lo propone Fernando y falta pasarlo a la Matriz.
> **Todo lo marcado PENDIENTE** no se implementa hasta que se acuerde.

---

## 1. Rutas (todas nuevas)

| Método | Ruta | Qué hace | Raíz XML |
|---|---|---|---|
| POST | `/v1/sync/batches` | Recibe un lote de capturas y devuelve el acuse por captura | petición `loteSync` · respuesta `acuseLote` |
| GET | `/v1/sync/batches/:batchId` | Vuelve a entregar el acuse de un lote | `acuseLote` |
| GET | `/v1/sync/batches` | Lista paginada de lotes (sin el detalle por captura) | `loteListResponse` |
| GET | `/v1/health` | Estado del servicio (sin autenticación) | `response` (`health.xsd`) |

## 2. Autenticación, permisos y correlación

### Autenticación

Todas las rutas, menos `GET /v1/health`, exigen `Authorization: Bearer <accessToken>`
**y** sesión activa en Redis (`SessionGuard` de la plantilla). Sin token, token expirado,
manipulado o sesión revocada → `401`. El autor de cada lote sale **del token**
(`userId`); el cuerpo no acepta `userId`, `capturedBy` ni `status` (→ `400`).

### Permiso por ruta

| Ruta | Roles | Nivel |
|---|---|---|
| `POST /v1/sync/batches` | `Investigador de mercado` (móvil, D-28); `Analista comercial` y `Responsable de precios` (escritorio, D-31) | Envía lo propio |
| `GET /v1/sync/batches/:batchId` | `Administrador`, `Auditor`: cualquier lote. `Investigador de mercado`, `Analista comercial`, `Responsable de precios`: **solo los suyos**; uno ajeno → `404` (mismo cuerpo que inexistente) | L / LP — **PROPUESTA** |
| `GET /v1/sync/batches` | Igual que la anterior: Admin y Auditor ven todos; los demás solo los suyos (el filtro `userId` solo lo aceptan Admin y Auditor; a otro rol → `403`) | L / LP — **PROPUESTA** |

Cualquier otro rol → `403`: `Gerente de categoría`, `Proveedor`, `Administrador` y
`Auditor` en el `POST`; y el **`Planeador`**, ver la nota de abajo.

**Permiso por tipo de captura.** El rol que puede *enviar* un lote no basta: cada captura
se revisa contra el rol que su servicio destino acepta para darla de alta (Matriz §3 y
contratos de destino). Si el rol no puede dar de alta ese tipo, **esa captura** queda
`rechazada` con `reason.code = FORBIDDEN`; las demás del lote siguen.

| `type` | Servicio destino | Roles que lo pueden enviar |
|---|---|---|
| `disponibilidad` | availability-service | `Investigador de mercado`, `Analista comercial` (contrato de availability) |
| `precio_observado` | pricing-service | `Investigador de mercado`, `Analista comercial`, `Responsable de precios` (contrato de pricing, `/v1/price-observations`) |

> **Planeador (contradicción con D-31 / §3.2).** La Matriz §3.2 dice que los roles del
> escritorio son los de D-31 (Analista, Responsable de precios y Planeador), pero el
> Planeador **no puede dar de alta** ningún tipo de captura en ningún servicio destino
> (M08 Precios: L; availability: L). Mientras no se le asigne un tipo, su `POST` responde
> `403`. Se reporta al Product Owner.

### Correlación (`X-Correlation-Id`, T-02)

- Se acepta el encabezado si cumple `^[A-Za-z0-9._:-]{1,100}$`; si falta o no cumple, el
  servicio genera un UUID. Se devuelve **siempre** en el encabezado de la respuesta
  (también en `401`, `413` y `503`).
- El mismo id va en: cada línea de log de la operación; cada llamada HTTP a
  availability-service, pricing-service, audit-service y notifications-service (se
  reenvía junto con el `Authorization` del usuario); el documento del lote en Mongo
  (`correlationId`) y el campo `correlationId` del acuse.
- Un reenvío del mismo lote trae su propio id de correlación; el acuse guarda el del
  **primer** envío y el log del reenvío anota los dos.

## 3. Unidades, ids y zona horaria

| Dato | Formato |
|---|---|
| `batchId`, `deviceId`, `captureId` | UUID generados **en el dispositivo**. `captureId` se conserva en cada reintento; `deviceId` se genera al instalar la app y no cambia. |
| `storeId`, `presentationId`, `userId` | UUID (`userId` sale del token; D-26: solo el id, nunca el nombre). |
| `capturedAt`, `sentAt` | ISO 8601 **con zona horaria obligatoria** (`Z` o `±hh:mm`), p. ej. `2026-10-26T09:30:00-06:00`. Sin zona → `400` del lote completo (es un error del cliente, no del dato). |
| `receivedAt`, `serverCapturedAt` y los instantes del acuse | Los devuelve el servidor **en UTC** (`…Z`, con milisegundos). |
| Días en filtros (`dateFrom`, `dateTo`) | `YYYY-MM-DD`, día local de **America/Monterrey** (UTC−06:00), inclusivos, igual que audit-service. |
| `content.stock` | Número ≥ 0, hasta 2 decimales, en **unidades de la presentación** (piezas, paquetes…). `0` = agotado. |
| `content.price` | Número > 0, hasta 2 decimales, en **MXN por presentación** (el precio de anaquel). |
| `content.lat`, `content.lng` | Grados decimales WGS84 (`-90..90`, `-180..180`); van **juntas** o ninguna. |
| `contractVersion` | `"1.0"` (única versión hoy). |

## 4. POST /v1/sync/batches

### 4.1 El lote: ejemplo JSON (app móvil)

```json
{
  "batchId": "6f1c2a9e-3b7d-4e2a-9c41-8d2f0b7a5e10",
  "deviceId": "a3b4c5d6-1111-4222-8333-944455556666",
  "contractVersion": "1.0",
  "client": "movil",
  "sentAt": "2026-10-30T09:02:00-06:00",
  "captures": [
    {
      "captureId": "c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11",
      "type": "disponibilidad",
      "contractVersion": "1.0",
      "capturedAt": "2026-10-26T09:30:00-06:00",
      "storeId": "27f05c81-c6bf-456a-a273-150e4edb9900",
      "presentationId": "5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77",
      "content": { "stock": 12 }
    },
    {
      "captureId": "d1b9023f-8e8d-4c6f-8b62-1e7f4f3bac22",
      "type": "precio_observado",
      "contractVersion": "1.0",
      "capturedAt": "2026-10-26T09:31:00-06:00",
      "storeId": "27f05c81-c6bf-456a-a273-150e4edb9900",
      "presentationId": "5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77",
      "content": { "price": 27.5, "lat": 25.6866, "lng": -100.3161 }
    },
    {
      "captureId": "e2ca1340-9f9e-4d70-9c73-2f80a54cbd33",
      "type": "disponibilidad",
      "contractVersion": "1.0",
      "capturedAt": "2026-10-27T10:00:00-06:00",
      "storeId": "27f05c81-c6bf-456a-a273-150e4edb9900",
      "presentationId": "8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e",
      "content": { "stock": 0 }
    },
    {
      "captureId": "f3db2451-a0af-4e81-8d84-3091b65dce44",
      "type": "precio_observado",
      "contractVersion": "1.0",
      "capturedAt": "2026-10-27T10:02:00-06:00",
      "storeId": "27f05c81-c6bf-456a-a273-150e4edb9900",
      "presentationId": "8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e",
      "content": { "price": -3 }
    }
  ]
}
```

### 4.2 El mismo lote en XML (app de escritorio)

`Content-Type: application/xml`. La raíz es `loteSync` con `xmlns="sync/v1"`; las listas
van como `<item>` y el servicio las convierte al arreglo del JSON, así que pasan por las
**mismas** validaciones. (En la práctica el escritorio manda `client = escritorio`; aquí se
deja `movil` para que sea el mismo lote que el ejemplo JSON.)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<loteSync xmlns="sync/v1">
  <batchId>6f1c2a9e-3b7d-4e2a-9c41-8d2f0b7a5e10</batchId>
  <deviceId>a3b4c5d6-1111-4222-8333-944455556666</deviceId>
  <contractVersion>1.0</contractVersion>
  <client>movil</client>
  <sentAt>2026-10-30T09:02:00-06:00</sentAt>
  <captures>
    <item>
      <captureId>c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11</captureId>
      <type>disponibilidad</type>
      <contractVersion>1.0</contractVersion>
      <capturedAt>2026-10-26T09:30:00-06:00</capturedAt>
      <storeId>27f05c81-c6bf-456a-a273-150e4edb9900</storeId>
      <presentationId>5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77</presentationId>
      <content><stock>12</stock></content>
    </item>
    <item>
      <captureId>d1b9023f-8e8d-4c6f-8b62-1e7f4f3bac22</captureId>
      <type>precio_observado</type>
      <contractVersion>1.0</contractVersion>
      <capturedAt>2026-10-26T09:31:00-06:00</capturedAt>
      <storeId>27f05c81-c6bf-456a-a273-150e4edb9900</storeId>
      <presentationId>5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77</presentationId>
      <content><price>27.5</price><lat>25.6866</lat><lng>-100.3161</lng></content>
    </item>
    <item>
      <captureId>e2ca1340-9f9e-4d70-9c73-2f80a54cbd33</captureId>
      <type>disponibilidad</type>
      <contractVersion>1.0</contractVersion>
      <capturedAt>2026-10-27T10:00:00-06:00</capturedAt>
      <storeId>27f05c81-c6bf-456a-a273-150e4edb9900</storeId>
      <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
      <content><stock>0</stock></content>
    </item>
    <item>
      <captureId>f3db2451-a0af-4e81-8d84-3091b65dce44</captureId>
      <type>precio_observado</type>
      <contractVersion>1.0</contractVersion>
      <capturedAt>2026-10-27T10:02:00-06:00</capturedAt>
      <storeId>27f05c81-c6bf-456a-a273-150e4edb9900</storeId>
      <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
      <content><price>-3</price></content>
    </item>
  </captures>
</loteSync>
```

### 4.3 Reglas del lote (nivel lote: si fallan, nada se procesa)

| Campo | Regla |
|---|---|
| `batchId` | obligatorio, UUID del dispositivo. El mismo `batchId` con **el mismo contenido** es un reenvío; con **otro contenido** → `409` |
| `deviceId` | obligatorio, UUID |
| `contractVersion` | obligatorio, `"1.0"`; otra versión → `400` |
| `client` | obligatorio: `movil` \| `escritorio` (va a la bitácora; no cambia permisos) |
| `sentAt` | opcional, con zona horaria; solo informativo |
| `captures` | obligatorio, de **1 a 500** elementos. Vacío → `400`; más de 500 → `413` |
| `captureId` repetido dentro del mismo lote | `400` |
| Estructura de cada captura | `captureId`, `type`, `contractVersion`, `capturedAt` (con zona) y `content` presentes; `storeId`/`presentationId`, si vienen, UUID. Si no → `400` (en XML, el XSD falla igual) |
| Tamaño del cuerpo | máximo **1 MB** → si no, `413` |
| XML | bien formado, raíz `loteSync`, sin `DOCTYPE`/`ENTITY`, válido contra el XSD → si no, `400` |
| Campos no listados | `400` |

### 4.4 Reglas por captura (nivel elemento: si fallan, solo esa captura queda `rechazada`)

| Regla | Si no se cumple |
|---|---|
| `contractVersion` de la captura = `"1.0"` | `rechazada`, `VALIDATION_ERROR` |
| `disponibilidad`: `storeId`, `presentationId` y `content.stock` (≥ 0, 2 decimales) | `rechazada`, `VALIDATION_ERROR` |
| `precio_observado`: `storeId`, `presentationId`, `content.price` (> 0, 2 decimales); `lat`/`lng` juntas y en rango | `rechazada`, `VALIDATION_ERROR` |
| `capturedAt` no más de **5 min en el futuro** (relojes de teléfono, igual que pricing y availability) | `rechazada`, `VALIDATION_ERROR` |
| El rol del token puede dar de alta ese `type` (tabla de §2) | `rechazada`, `FORBIDDEN` |
| El `captureId` no lo usó **otro** usuario | `rechazada`, `CONFLICT` (no se revela la captura ajena) |
| El `captureId` ya se usó por el mismo usuario con **otro contenido** | `rechazada`, `CONFLICT` ("un dato corregido lleva un `captureId` nuevo") |
| Tienda o presentación inexistente (lo dice el destino con `400`) | `rechazada`, `VALIDATION_ERROR` |

### 4.5 Respuesta: el acuse (`200`)

`200` siempre que el lote se procesó, **con cualquier mezcla de resultados** (todas
aceptadas, todas rechazadas o mixto). No se usa `207`: el resultado de cada captura va en
`results[].status` y el conteo en `summary`. `results` sigue el **orden del lote**.

```json
{
  "batchId": "6f1c2a9e-3b7d-4e2a-9c41-8d2f0b7a5e10",
  "deviceId": "a3b4c5d6-1111-4222-8333-944455556666",
  "userId": "9d2e7f40-5a61-4c1b-8e3f-2b7c9a0d4e55",
  "client": "movil",
  "contractVersion": "1.0",
  "receivedAt": "2026-10-30T15:02:01.120Z",
  "resend": false,
  "correlationId": "4b8f0c2e-6a1d-4f3b-9e27-5c0d8a1b3f66",
  "summary": { "total": 4, "aceptadas": 2, "duplicadas": 0, "conflictos": 1, "rechazadas": 1 },
  "results": [
    {
      "captureId": "c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11",
      "type": "disponibilidad",
      "status": "aceptada",
      "capturedAt": "2026-10-26T15:30:00.000Z",
      "target": { "service": "availability-service", "id": "c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11" },
      "reason": null,
      "retryable": false
    },
    {
      "captureId": "d1b9023f-8e8d-4c6f-8b62-1e7f4f3bac22",
      "type": "precio_observado",
      "status": "aceptada",
      "capturedAt": "2026-10-26T15:31:00.000Z",
      "target": { "service": "pricing-service", "id": "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" },
      "reason": null,
      "retryable": false
    },
    {
      "captureId": "e2ca1340-9f9e-4d70-9c73-2f80a54cbd33",
      "type": "disponibilidad",
      "status": "conflicto",
      "capturedAt": "2026-10-27T16:00:00.000Z",
      "target": { "service": "availability-service", "id": "e2ca1340-9f9e-4d70-9c73-2f80a54cbd33" },
      "serverCapturedAt": "2026-10-28T16:00:00.000Z",
      "reason": { "code": "CONFLICT", "message": "El servidor ya tiene un dato de esta tienda y presentación capturado el 2026-10-28T16:00:00.000Z, más reciente que esta captura. No se sobrescribió; la captura quedó guardada." },
      "retryable": false
    },
    {
      "captureId": "f3db2451-a0af-4e81-8d84-3091b65dce44",
      "type": "precio_observado",
      "status": "rechazada",
      "capturedAt": "2026-10-27T16:02:00.000Z",
      "target": null,
      "reason": { "code": "VALIDATION_ERROR", "message": "content.price debe ser mayor a 0." },
      "retryable": false
    }
  ]
}
```

El mismo acuse en XML (`Accept: application/xml`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<acuseLote xmlns="sync/v1">
  <batchId>6f1c2a9e-3b7d-4e2a-9c41-8d2f0b7a5e10</batchId>
  <deviceId>a3b4c5d6-1111-4222-8333-944455556666</deviceId>
  <userId>9d2e7f40-5a61-4c1b-8e3f-2b7c9a0d4e55</userId>
  <client>movil</client>
  <contractVersion>1.0</contractVersion>
  <receivedAt>2026-10-30T15:02:01.120Z</receivedAt>
  <resend>false</resend>
  <correlationId>4b8f0c2e-6a1d-4f3b-9e27-5c0d8a1b3f66</correlationId>
  <summary>
    <total>4</total><aceptadas>2</aceptadas><duplicadas>0</duplicadas><conflictos>1</conflictos><rechazadas>1</rechazadas>
  </summary>
  <results>
    <item>
      <captureId>c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11</captureId>
      <type>disponibilidad</type>
      <status>aceptada</status>
      <capturedAt>2026-10-26T15:30:00.000Z</capturedAt>
      <target><service>availability-service</service><id>c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11</id></target>
      <retryable>false</retryable>
    </item>
    <item>
      <captureId>d1b9023f-8e8d-4c6f-8b62-1e7f4f3bac22</captureId>
      <type>precio_observado</type>
      <status>aceptada</status>
      <capturedAt>2026-10-26T15:31:00.000Z</capturedAt>
      <target><service>pricing-service</service><id>7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d</id></target>
      <retryable>false</retryable>
    </item>
    <item>
      <captureId>e2ca1340-9f9e-4d70-9c73-2f80a54cbd33</captureId>
      <type>disponibilidad</type>
      <status>conflicto</status>
      <capturedAt>2026-10-27T16:00:00.000Z</capturedAt>
      <target><service>availability-service</service><id>e2ca1340-9f9e-4d70-9c73-2f80a54cbd33</id></target>
      <serverCapturedAt>2026-10-28T16:00:00.000Z</serverCapturedAt>
      <reason>
        <code>CONFLICT</code>
        <message>El servidor ya tiene un dato de esta tienda y presentación capturado el 2026-10-28T16:00:00.000Z, más reciente que esta captura. No se sobrescribió; la captura quedó guardada.</message>
      </reason>
      <retryable>false</retryable>
    </item>
    <item>
      <captureId>f3db2451-a0af-4e81-8d84-3091b65dce44</captureId>
      <type>precio_observado</type>
      <status>rechazada</status>
      <capturedAt>2026-10-27T16:02:00.000Z</capturedAt>
      <reason><code>VALIDATION_ERROR</code><message>content.price debe ser mayor a 0.</message></reason>
      <retryable>false</retryable>
    </item>
  </results>
</acuseLote>
```

| Campo del resultado | Significado |
|---|---|
| `status` | `aceptada` \| `duplicada` \| `conflicto` \| `rechazada` (D-42) |
| `originalStatus` | Solo cuando `status = duplicada`: el resultado que tuvo la captura la primera vez (`aceptada`, `conflicto` o `rechazada`) |
| `target` | Servicio destino y el id que asignó (`null` si nunca llegó a un destino) |
| `serverCapturedAt` | Solo en `conflicto`: cuándo se **capturó** el dato más reciente que ganó |
| `reason` | `{code, message}` con `code` del catálogo estándar; `null` en `aceptada` |
| `retryable` | `true` solo si la captura falló porque un destino no respondió: **no se memoriza**, y el siguiente envío la vuelve a procesar |

### 4.6 Qué significa cada estado

| `status` | Cuándo | ¿Se guarda? |
|---|---|---|
| `aceptada` | El destino la registró. | Sí: en `capturas_sync` (Mongo) y en el destino. |
| `duplicada` | Ese `captureId` ya tenía un resultado **final** (aceptada, conflicto o rechazada no reintentable) del mismo usuario. No se crea nada; se devuelve `originalStatus` y el `target` de la primera vez. | No se vuelve a guardar. |
| `conflicto` | Ya existe un dato **capturado después** para la misma tienda, presentación y tipo (D-42). **No sobrescribe y no se pierde.** | Sí: la captura completa queda en `capturas_sync` con su `reason`. |
| `rechazada` | Falla una regla de §4.4, o el destino respondió `400`/`403`/`409`, o el destino no respondió (`retryable: true`). | Sí, con su `reason`. |

### 4.7 Regla de conflicto (D-42): gana la captura **más reciente según cuándo se hizo**

Se compara `capturedAt` (cuándo se **hizo**), nunca `receivedAt` (cuándo se **subió**): una
captura del lunes sincronizada el viernes pierde contra una del jueves. Se revisa en este
orden, sin leer tablas de otros servicios:

1. **Dentro del mismo lote.** Si dos capturas del mismo `type` tienen la misma tienda y
   presentación, solo la de `capturedAt` mayor sigue; las otras quedan `conflicto`
   ("hay una captura más reciente en el mismo lote") y se guardan. Empate exacto: gana la
   que aparece primero en el lote.
2. **Contra lo que este servicio ya aceptó** (último estado en Redis, D-47). Si ya aceptó
   para esa tienda + presentación + tipo una captura con `capturedAt` mayor → `conflicto`
   sin ir al destino.
3. **Contra el destino.** El destino puede tener datos que no pasaron por aquí (p. ej. una
   corrección del Analista desde la web). Si el destino responde que tiene un dato más
   reciente, el resultado es `conflicto` con su `serverCapturedAt`. **Cómo lo responde cada
   destino es PENDIENTE de acuerdo con Pamela** (§6).

**Se avisa al usuario** con el acuse (D-42: "se acusa al dispositivo con su estado"); la app
muestra cada `conflicto` con su `reason`. Un aviso adicional en la bandeja
(`sync.conflicto`) es **PROPUESTA** y depende de notifications-service (§8).

### 4.8 Idempotencia y recuperación (D-42, D-47)

- **Reenviar el mismo lote no duplica.** Mismo `batchId` + mismo contenido (hash SHA-256 de
  las capturas en orden) → `200` con `resend: true`, cada captura final como
  `duplicada` con su `originalStatus` y `target`. Así, **si la respuesta se perdió, el
  siguiente envío recupera el resultado.**
- Las capturas con `retryable: true` se **vuelven a procesar** en el reenvío (no son
  resultado final). Su resultado nuevo actualiza el lote guardado.
- Una captura ya resuelta que llega en **otro** lote (el dispositivo rearmó la cola) también
  sale `duplicada`: la idempotencia es por `captureId`, no solo por lote.
- Dos envíos **simultáneos** del mismo `batchId`: el primero toma un candado en Redis
  (`SET NX`, 60 s); el segundo → `409` "el lote se está procesando; reintenta". Al
  terminar, un reenvío normal devuelve el acuse.
- El mismo `batchId` con **contenido distinto** → `409` (no se mezclan lotes).
- `GET /v1/sync/batches/:batchId` también entrega el acuse guardado, sin reprocesar nada.

Ejemplo de reenvío del lote de §4.1 (`200`, abreviado: las cuatro capturas salen igual):

```json
{
  "batchId": "6f1c2a9e-3b7d-4e2a-9c41-8d2f0b7a5e10",
  "resend": true,
  "summary": { "total": 4, "aceptadas": 0, "duplicadas": 4, "conflictos": 0, "rechazadas": 0 },
  "results": [
    {
      "captureId": "c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11",
      "type": "disponibilidad",
      "status": "duplicada",
      "originalStatus": "aceptada",
      "capturedAt": "2026-10-26T15:30:00.000Z",
      "target": { "service": "availability-service", "id": "c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11" },
      "reason": null,
      "retryable": false
    }
  ]
}
```

Una captura que falló porque el destino no respondió (y que el siguiente envío reprocesa):

```json
{
  "captureId": "04ec3562-b1b0-4f92-9e95-41a2c76edf55",
  "type": "disponibilidad",
  "status": "rechazada",
  "capturedAt": "2026-10-28T17:10:00.000Z",
  "target": null,
  "reason": { "code": "SERVICE_UNAVAILABLE", "message": "availability-service no respondió en 3 s. Reintenta el lote." },
  "retryable": true
}
```

### 4.9 Ejemplos de rechazo del lote

`400`: capturas sin zona horaria (el lote completo no se procesa). Respuesta en XML
(`Accept: application/xml`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<error xmlns="sync/v1">
  <statusCode>400</statusCode>
  <message>El lote no es válido.</message>
  <code>VALIDATION_ERROR</code>
  <details>
    <item>captures[0].capturedAt debe incluir zona horaria (Z o ±hh:mm)</item>
  </details>
  <path>/v1/sync/batches</path>
  <timestamp>2026-10-30T15:02:01.120Z</timestamp>
</error>
```

`413`: más de 500 capturas o cuerpo mayor a 1 MB.

```json
{
  "statusCode": 413,
  "message": "El lote excede el máximo de 500 capturas (trae 812). Divídelo en lotes más chicos.",
  "code": "VALIDATION_ERROR",
  "details": null,
  "path": "/v1/sync/batches",
  "timestamp": "2026-10-30T15:02:01.120Z"
}
```

`403`: un `Gerente de categoría` (o `Planeador`, `Proveedor`, `Administrador`, `Auditor`)
envía un lote.

```json
{ "statusCode": 403, "message": "Tu rol no puede sincronizar capturas.", "code": "FORBIDDEN",
  "details": null, "path": "/v1/sync/batches", "timestamp": "2026-10-30T15:02:01.120Z" }
```

`409`: el mismo `batchId` con otro contenido.

```json
{ "statusCode": 409, "message": "El batchId ya se usó con otro contenido. Un lote nuevo lleva un batchId nuevo.",
  "code": "CONFLICT", "details": null, "path": "/v1/sync/batches", "timestamp": "2026-10-30T15:02:01.120Z" }
```

`503`: MongoDB o Redis no responden. **No se procesa ninguna captura** (sin almacén no se
puede garantizar la idempotencia), así que el dispositivo reintenta el lote entero.

```json
{ "statusCode": 503, "message": "No se pudo guardar el lote: MongoDB no responde. Reintenta más tarde.",
  "code": "SERVICE_UNAVAILABLE", "details": null, "path": "/v1/sync/batches", "timestamp": "2026-10-30T15:02:01.120Z" }
```

### 4.10 Códigos HTTP del POST

| Status | Cuándo |
|---|---|
| `200` | Lote procesado, **con resultados mixtos o no** (también un reenvío, `resend: true`) |
| `400` | Lote mal formado (§4.3): JSON/XML inválido, XSD, raíz distinta, `DOCTYPE`/`ENTITY`, campos faltantes, sin zona horaria, `captureId` repetido en el lote, versión de lote no soportada, `Content-Type` distinto de JSON o XML |
| `401` | Sin token, token inválido o expirado, sin sesión en Redis |
| `403` | Rol sin permiso sobre la ruta (§2) |
| `409` | `batchId` ya usado con otro contenido; el mismo lote se está procesando |
| `413` | Más de 500 capturas o cuerpo mayor a 1 MB (`code: VALIDATION_ERROR`, como dice el catálogo) |
| `503` | MongoDB o Redis no responden (D-25); no se procesó nada |

Un destino caído **no** da `503` al lote: solo deja sus capturas `rechazada` con
`retryable: true`.

## 5. Consultas de lotes

### GET /v1/sync/batches/:batchId

Devuelve el acuse guardado (`acuseLote`) con el estado **actual** de cada captura
(incluido el de las reintentables ya reprocesadas). No reprocesa nada.

- Válido: `GET /v1/sync/batches/6f1c2a9e-3b7d-4e2a-9c41-8d2f0b7a5e10` por su autor →
  `200` con el acuse de §4.5.
- Rechazo: el mismo lote pedido por **otro** Investigador → `404` (mismo cuerpo que un lote
  inexistente; no se confirma que exista). `batchId` que no es UUID → `400`.

```json
{ "statusCode": 404, "message": "Lote no encontrado.", "code": "NOT_FOUND", "details": null,
  "path": "/v1/sync/batches/6f1c2a9e-3b7d-4e2a-9c41-8d2f0b7a5e10", "timestamp": "2026-10-30T15:05:00.000Z" }
```

### GET /v1/sync/batches

Paginado (`paginacion.md`), el más reciente (`receivedAt`) primero. Query opcional:
`deviceId`, `status` (lotes con al menos una captura en ese estado, p. ej.
`status=conflicto`), `dateFrom`, `dateTo` (`YYYY-MM-DD`, America/Monterrey) y `userId`
(solo Admin y Auditor).

Válido (`200`, `loteListResponse`):

```json
{
  "data": [
    {
      "batchId": "6f1c2a9e-3b7d-4e2a-9c41-8d2f0b7a5e10",
      "deviceId": "a3b4c5d6-1111-4222-8333-944455556666",
      "userId": "9d2e7f40-5a61-4c1b-8e3f-2b7c9a0d4e55",
      "client": "movil",
      "receivedAt": "2026-10-30T15:02:01.120Z",
      "summary": { "total": 4, "aceptadas": 2, "duplicadas": 0, "conflictos": 1, "rechazadas": 1 }
    }
  ],
  "total": 1, "page": 1, "limit": 20
}
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<loteListResponse xmlns="sync/v1">
  <data>
    <item>
      <batchId>6f1c2a9e-3b7d-4e2a-9c41-8d2f0b7a5e10</batchId>
      <deviceId>a3b4c5d6-1111-4222-8333-944455556666</deviceId>
      <userId>9d2e7f40-5a61-4c1b-8e3f-2b7c9a0d4e55</userId>
      <client>movil</client>
      <receivedAt>2026-10-30T15:02:01.120Z</receivedAt>
      <summary><total>4</total><aceptadas>2</aceptadas><duplicadas>0</duplicadas><conflictos>1</conflictos><rechazadas>1</rechazadas></summary>
    </item>
  </data>
  <total>1</total>
  <page>1</page>
  <limit>20</limit>
</loteListResponse>
```

Rechazo: un Investigador manda `?userId=<otro>` → `403`; `status=procesado` (fuera de la
lista) o `dateFrom > dateTo` → `400`.

```json
{ "statusCode": 400, "message": "Parámetros inválidos.", "code": "VALIDATION_ERROR",
  "details": ["status debe ser uno de: aceptada, duplicada, conflicto, rechazada"],
  "path": "/v1/sync/batches", "timestamp": "2026-10-30T15:05:00.000Z" }
```

## 6. Envío a los servicios destino — PENDIENTE de acuerdo con Pamela

**Nada de esta sección está acordado.** Pamela es dueña de availability-service y
pricing-service (y de catalog-service para visitas de campo). Hasta acordarlo, el servicio
**no** se programa contra estos destinos; el sobre del lote y del acuse (§4) sí es final.

Lo que este contrato **necesita** de cada destino (no lo que el destino debe hacer):

| `type` | Destino que se propone | Lo que falta acordar |
|---|---|---|
| `disponibilidad` | `POST /v1/availability/captures` (ya acepta `captureId` y `capturedAt`) | Confirmar el mapeo de estados. El contrato de availability ya dice, desde su lado, que `aceptada`/`duplicada`/`conflicto` se traducen igual y un `400` es `rechazada`; falta confirmar qué hacer con su `409` (captureId de otro usuario) y que acepte `origin: movil \| escritorio` según `client`. |
| `precio_observado` | `POST /v1/price-observations` | Pricing **no** recibe `captureId` (no hay idempotencia del lado destino si la respuesta se pierde entre sync y pricing) ni responde "conflicto": toda observación queda `pendiente` de aprobación (D-16). Opciones a decidir con Pamela: (a) pricing acepta `captureId` y lo usa como llave única; (b) sync guarda el id de la observación y nunca reenvía una captura que ya tiene `target`. Y si la regla de "dato más reciente" (D-42) aplica contra precios u observaciones ya registrados. |
| `visita_campo` (D-30) | catalog-service, colección `visitas_campo` | No hay ruta en el contrato de catalog. **No entra en la versión 1.0.** |
| `propuesta_producto` (D-32) | `POST /v1/products/proposals` | Hoy la ruta solo acepta al `Proveedor`; D-32 pide que el Investigador proponga con origen "campo". **No entra en la versión 1.0.** |

Regla que sí es de este contrato: cada llamada a un destino reenvía el `Authorization` del
usuario y el `X-Correlation-Id`, con **timeout de 3 s**. Sin respuesta → la captura queda
`rechazada`, `SERVICE_UNAVAILABLE`, `retryable: true`.

## 7. Persistencia (D-47)

| Almacén | Qué guarda | Llave / vigencia |
|---|---|---|
| MongoDB `lotes_sync` | Un documento por lote: sobre, hash del contenido, `userId`, `correlationId`, `receivedAt`, el acuse y el estado de los avisos (§8) | `_id = batchId`. Índices `{userId, receivedAt}`, `{deviceId, receivedAt}` |
| MongoDB `capturas_sync` | Una por captura, **con su contenido completo** (así un `conflicto` no se pierde): `batchId`, `userId`, `type`, `storeId`, `presentationId`, `capturedAt`, `status`, `target`, `reason` | `_id = captureId` (único: es la idempotencia durable). Índice `{type, storeId, presentationId, capturedAt}` |
| Redis `sync:lock:{batchId}` | Candado del lote en proceso | `SET NX`, 60 s |
| Redis `sync:captura:{captureId}` | Resultado final (`userId`, `status`, `target`), caché rápida de la idempotencia | 7 días; si no está, se consulta Mongo |
| Redis `sync:ultimo:{type}:{storeId}:{presentationId}` | `capturedAt` de la última captura **aceptada** ("último estado", D-47) | Sin vencimiento; si falta, se reconstruye desde `capturas_sync` |

- No usa PostgreSQL (en el health sale `"no configurado"`).
- **Retención (D-43):** capturas de campo 1 año → índice TTL de 365 días sobre
  `receivedAt` en las dos colecciones. Confirmar con Leonardo (data-governance-service) si
  la purga la hace este índice o su servicio.
- Mongo o Redis caídos → `503` (D-25) y no se procesa nada.

## 8. Auditoría y avisos (no bloqueantes)

Se envían **después** de guardar el acuse, sin esperar su resultado para responder, con
timeout de **1.5 s**, reenviando el `Authorization` del usuario y el `X-Correlation-Id`.
Si fallan (error, `4xx`, `5xx`, timeout o servicio caído), la sincronización **igual se
completa** y queda evidencia en dos lugares:

1. Línea de log `WARN aviso_fallido` con `correlationId`, destino (`audit-service` o
   `notifications-service`), evento, `batchId` y motivo (sin tokens).
2. El documento del lote: `delivery.audit` y `delivery.notification` =
   `enviado` | `fallido` | `no_aplica`, con `delivery.*Error`.

| Qué | Cuándo | Cuerpo |
|---|---|---|
| Auditoría | Lote nuevo (no en un reenvío sin cambios). Si un reenvío reprocesa reintentables → otro evento | `POST /v1/auditoria`: `tabla: "lotes_sync"`, `registroId: batchId`, `servicio: "offline-sync-service"`, `accion: "insert"` (o `"update"` al reprocesar), `descripcion` con el conteo por estado y el `client` |
| Aviso `sync.conflicto` — **PROPUESTA** | El lote dejó al menos un `conflicto` | Un solo aviso por lote al usuario que lo envió (`recipientUserId`), `priority: "warning"`, con el número de conflictos. Informativo (D-46: se puede apagar) |

Cada captura aceptada la audita **su destino** (availability o pricing); aquí no se repite.

**Dependencia con Juan Ángel (bloqueante para auditar y avisar):** hoy audit-service acepta
solo los 10 servicios originales en `servicio`, y notifications-service tiene listas
cerradas de `sourceService` y `eventType`. Hay que agregar `offline-sync-service` y el
evento `sync.conflicto` (T-19 / T-20). Mientras no estén, audit y notifications responden
`400`, y queda la evidencia de arriba.

## 9. GET /v1/health

Sin autenticación; siempre `200` si el proceso responde (`health.xsd`, raíz `response`,
sin namespace). Usa MongoDB y Redis; PostgreSQL sale `"no configurado"`.

Válido:

```json
{
  "status": "ok",
  "service": "offline-sync-service",
  "version": "1.0.0",
  "checks": { "postgres": "no configurado", "mongodb": "ok", "redis": "ok" },
  "latencyMs": { "postgres": 0, "mongodb": 4, "redis": 1 },
  "durationMs": 6,
  "timestamp": "2026-10-30T15:00:00.000Z"
}
```

Degradado (MongoDB caído: el `POST` responde `503`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<response>
  <status>degraded</status>
  <service>offline-sync-service</service>
  <version>1.0.0</version>
  <checks>
    <postgres>no configurado</postgres>
    <mongodb>error: connection refused</mongodb>
    <redis>ok</redis>
  </checks>
  <latencyMs><postgres>0</postgres><mongodb>3001</mongodb><redis>1</redis></latencyMs>
  <durationMs>3003</durationMs>
  <timestamp>2026-10-30T15:00:00.000Z</timestamp>
</response>
```

## 10. Casos de control (pruebas)

| # | Caso | Resultado esperado |
|---|---|---|
| 1 | Enviar el lote de §4.1 dos veces | 2.ª vez: `resend: true`, las 4 `duplicada` con su `originalStatus` (D-42) |
| 2 | Captura del lunes subida el viernes; el servidor tiene una del jueves | `conflicto`, `serverCapturedAt` = jueves; nada se sobrescribe |
| 3 | Dos capturas de la misma tienda + presentación en el mismo lote (10:00 y 11:00) | la de 11:00 sigue; la de 10:00 `conflicto` |
| 4 | El destino no responde en 3 s | `rechazada`, `retryable: true`; el siguiente envío la procesa |
| 5 | `captureId` de otro usuario | `rechazada`, `CONFLICT`, sin datos de la captura ajena |
| 6 | 501 capturas | `413` |
| 7 | `capturedAt` sin zona | `400` del lote |
| 8 | Responsable de precios manda `disponibilidad` | esa captura `rechazada`, `FORBIDDEN`; las demás siguen |
| 9 | MongoDB detenido | `POST` → `503`; health → `degraded` |
