# Retail Decision — App de escritorio

Electron + React + TypeScript + Vite. **XML exclusivo**: pide siempre `Accept: application/xml` y
comprueba cada respuesta contra el contrato. No es una copia del sistema web. Responsable: Fernando.

## Quién entra (D-31)

Solo **Analista comercial**, **Responsable de precios** y **Planeador**. Cualquier otro perfil
(Administrador, Gerente de categoría, Auditor, Proveedor, Investigador de mercado) inicia sesión en
auth-service, la app cierra esa sesión en el acto y el login muestra **"Acceso no permitido"** sin
redirigir (no hay bucle). Todo vive en `src/config/menu.ts`; los servicios vuelven a revisar el
permiso y responden 403.

| Sección | Servicio(s) | Analista | Resp. precios | Planeador |
|---|---|---|---|---|
| Comparar zonas | catalog-service | consulta | consulta | consulta |
| Reglas de asociación (Apriori y FP-Growth) | algorithms-core · catalog | **ejecuta** y consulta | consulta | consulta |
| Elasticidad (vigente, comparación por zona o segmento, cálculo) | algorithms-core · catalog | consulta | **calcula** y consulta | consulta |
| Segmentos de ingreso (versiones, D-35) | income-segmentation-service | **crea, versiona, borra** | consulta | consulta |
| Simulación (precio/descuento y empaque) | decision-service · catalog | escenarios guardados | escenarios guardados | **simula** |
| Importar ventas | transactions-ingestion-service | **importa** | – | – |
| Promociones (lista con filtros, detalle, precio unitario, comparar) | promotion-service · catalog | consulta | **aprueba y rechaza** (bandeja) y consulta | consulta |
| Seguimiento de recomendaciones (lista, "Mis seguimientos", detalle, historial) | recommendations-workflow-service · decision | consulta; **inicia y marca implementado si es el asignado** | igual | igual |
| Reportes ejecutivos (ver y descargar PDF/Excel/CSV) | documents-service | consulta | consulta | consulta |

**Lo del Gerente de categoría va en la web** (reparto aprobado por el Product Owner): proponer
promociones y asignar y evaluar seguimientos. El Gerente no entra al escritorio (D-31), así que esos
botones no existen aquí para nadie. En Seguimiento, los botones **Iniciar** y **Marcar implementada**
solo aparecen para el usuario asignado (id del token = `assigneeUserId`) y solo el paso que sigue;
la evaluación se muestra en solo lectura. Los `409` se muestran claros: en promociones, "ya resuelta"
o "ya vencida"; en seguimiento, el estado actual que manda `details`.

Cada sección muestra en el encabezado el servicio que la alimenta. Todas las tablas se exportan a
CSV y XML (`BotonesExportar`); los reportes se descargan tal cual los arma documents-service.

## XML: qué se envía, qué se recibe y qué se valida

| Servicio | Recibe del escritorio | Responde |
|---|---|---|
| transactions-ingestion-service | **XML** (`objectImport`) y el archivo de ventas adjunto (CSV/JSON/XML `salesFile`) | XML (`ingestion/v1`) |
| decision-service | **XML** en la simulación: `simulacionPrecioRequest` y `simulacionPresentacionRequest` | XML (`decision/v1`) |
| promotion-service | **XML** al rechazar: `rechazoPromocionRequest` (aprobar va sin cuerpo) | XML (`promotion/v1`) |
| recommendations-workflow-service | **XML** al marcar implementada: `implementacionRequest` (iniciar va sin cuerpo) | XML (`workflow/v1`) |
| auth, catalog, algorithms-core, income-segmentation, documents | **JSON** (no leen XML de entrada) | XML (namespace de cada uno) |

- **En ejecución** (`src/api/xml.ts`, `src/api/httpClient.ts`): cada respuesta debe ser XML bien
  formado, sin DOCTYPE, con la **raíz** y el **namespace** que declara el XSD para esa ruta; un éxito
  en JSON se rechaza. Los errores se leen en XML (`<error>`, con sus campos obligatorios) o en JSON.
  El archivo de ventas XML se revisa antes de subirlo (raíz `salesFile`, namespace, filas).
- **En pruebas** (`test/xsd.test.ts`): validación **completa** contra los XSD de `docs/contratos/` con
  libxml2 (`xmllint-wasm`): las respuestas que la app sabe leer, los ejemplos del contrato de ingesta
  y el XML que la app arma. `test/promociones-seguimiento.test.ts` lee **todos** los bloques XML de
  los contratos de promotion-service y recommendations-workflow-service, los valida contra su XSD y
  los pasa por los parsers; también valida los cuerpos de rechazo, implementación y simulación. No se carga el validador en la ventana (pesa ~2 MB de WebAssembly).

## Importar ventas

`transactions-ingestion-service` (3111) sigue su contrato oficial,
`docs/contratos/transactions-ingestion-service.md` y `.xsd`. El servicio todavía no está en
`services/`, así que se probó contra el contrato y sus ejemplos (`docs/contratos/ejemplos/`), no
contra el servicio. La pantalla separa:

1. **Archivo de ventas** (los datos): se adjunta en la parte `file` de un multipart → vista previa.
2. **Mensaje de control**: `objectImport` en XML (importar un objeto del bucket), **confirmar**
   (idempotente: repetirlo no duplica, D-34) y **descartar** (antes de confirmar).

La vista previa muestra los conteos y los errores **por fila** (rechazadas y en conflicto).

## Ambientes y URLs

| Modo | Archivo | URLs |
|---|---|---|
| `npm run dev` / `electron:dev` | `.env.development` | `http://localhost:31xx/` |
| `npm run build:staging` | `.env.staging` | HTTPS, servidor de staging: `https://34.51.89.203/api/<servicio>/` |
| `npm run build` | `.env.production` | HTTPS, servidor de staging: `https://34.51.89.203/api/<servicio>/` |

Las dos apuntan al servidor de staging (VM del equipo, HTTPS con Caddy). El build de staging o producción **se
detiene** si una URL no es `https://`, apunta a un host local o trae puerto, y si el JS generado
contiene un host local con puerto. Variables: ver `.env.example`.

## Preparar datos para la demo

Con el docker-compose arriba y el seed cargado (`db/data_retail.sql`; contraseña de todos:
`Passw0rd123!`). Todo pasa por las rutas de los servicios; **nada se escribe directo en la base**.
Copia los bloques en PowerShell, en orden (cada bloque usa variables del anterior).

**1. Sesiones** (auth-service, 3101). El id del Analista sale de su login:

```powershell
$auth = 'http://localhost:3101/v1'
function Iniciar-Sesion($correo) {
  Invoke-RestMethod -Method Post -Uri "$auth/auth/login" -ContentType 'application/json' `
    -Body (@{ email = $correo; password = 'Passw0rd123!' } | ConvertTo-Json)
}
$gerente   = Iniciar-Sesion 'gercategoria@retail.mx'
$planeador = Iniciar-Sesion 'planeador@retail.mx'
$analista  = Iniciar-Sesion 'analista@retail.mx'
$hGerente   = @{ Authorization = "Bearer $($gerente.accessToken)" }
$hPlaneador = @{ Authorization = "Bearer $($planeador.accessToken)" }
$idAnalista = $analista.usuario.id
```

**2. Tres promociones del mismo producto, una de cada tipo** (el Gerente propone en
promotion-service, 3115; nacen `pendiente`). Producto, presentación y tienda salen de catalog (3102):

```powershell
$cat = 'http://localhost:3102/v1'
$productos = (Invoke-RestMethod -Uri "$cat/products?limit=100" -Headers $hGerente).data
$producto  = $productos | Where-Object { $_.estatus -eq 'activo' -and ($_.presentaciones | Where-Object activo) } | Select-Object -First 1
$pres      = $producto.presentaciones | Where-Object activo | Select-Object -First 1
$tienda    = (Invoke-RestMethod -Uri "$cat/stores?limit=100" -Headers $hGerente).data | Select-Object -First 1
$hoy       = (Get-Date).ToString('yyyy-MM-dd')       # validFrom no puede ser pasado
$hasta     = (Get-Date).AddDays(14).ToString('yyyy-MM-dd')
"Producto: $($producto.nombre) / $($pres.nombre) ($($pres.contenido) $($pres.unidadMedida.clave)) / tienda $($tienda.nombre)"

$promo = 'http://localhost:3115/v1/promotions'
$base = @{ productId = $producto.id; presentationId = $pres.id; storeId = $tienda.id; validFrom = $hoy; validTo = $hasta }
$promos = @(
  $base + @{ name = "$($producto.nombre): 10 % de descuento"; type = 'descuento_porcentual'; discountPct = 10 },
  $base + @{ name = "$($producto.nombre): 3 por 80";          type = 'paquete'; packQuantity = 3; packPrice = 80 },
  # Tamaño de empaque: 20 % más contenido, en la MISMA unidad de la presentación (si no, 400).
  $base + @{ name = "$($producto.nombre): 20 % más contenido"; type = 'tamano_empaque';
             promoContent = [math]::Round([double]$pres.contenido * 1.2, 3); promoUnit = $pres.unidadMedida.clave; promoPrice = 30 }
)
foreach ($p in $promos) {
  $r = Invoke-RestMethod -Method Post -Uri $promo -Headers $hGerente -ContentType 'application/json' -Body ($p | ConvertTo-Json)
  "$($r.type): $($r.id) ($($r.status))"
}
```

**3. Una recomendación aceptada** (decision-service, 3107). Si ya hay una `aceptada`, se usa esa;
si no, el Planeador genera y el Gerente aprueba la primera propuesta:

```powershell
$dec = 'http://localhost:3107/v1'
$acept = (Invoke-RestMethod -Uri "$dec/recommendations?status=aceptada&limit=1" -Headers $hGerente).data | Select-Object -First 1
if (-not $acept) {
  Invoke-RestMethod -Method Post -Uri "$dec/recommendations/generate" -Headers $hPlaneador -ContentType 'application/json' -Body '{}' | Out-Null
  $prop = (Invoke-RestMethod -Uri "$dec/recommendations?status=propuesta&limit=1" -Headers $hGerente).data | Select-Object -First 1
  if (-not $prop) { throw 'Ninguna regla generó recomendaciones con los datos actuales.' }
  $acept = Invoke-RestMethod -Method Patch -Uri "$dec/recommendations/$($prop.id)/approve" -Headers $hGerente
  $idRec = $acept.recommendationId
} else { $idRec = $acept.id }
"Recomendación aceptada: $idRec"
```

**4. El Gerente asigna el seguimiento al Analista** (recommendations-workflow-service, 3117):

```powershell
$wf = 'http://localhost:3117/v1/workflow/assignments'
$asig = @{ recommendationId = $idRec; assigneeUserId = $idAnalista; dueDate = (Get-Date).AddDays(7).ToString('yyyy-MM-dd');
           note = 'Aplicar la recomendación en las tiendas de la zona y registrar qué se hizo.' }
$seg = Invoke-RestMethod -Method Post -Uri $wf -Headers $hGerente -ContentType 'application/json' -Body ($asig | ConvertTo-Json)
"Seguimiento $($seg.id) asignado a analista@retail.mx ($($seg.status))"
```

En la demo: **precios@retail.mx** ve las 3 promociones en su bandeja (precio unitario, comparar,
aprobar o rechazar) y **analista@retail.mx** ve el seguimiento en "Mis seguimientos" con los botones
Iniciar y Marcar implementada. Repetir el paso 4 con el mismo Analista devuelve el mismo seguimiento
(no duplica). Si la tienda no tiene precio vigente para esa presentación, el precio unitario regular
sale "no disponible" con su motivo (nunca 0): es el comportamiento del contrato.

## Comandos

```bash
npm install
npm run electron:dev     # desarrollo con los servicios del docker-compose
npm run typecheck        # tsc del código React, las pruebas y Electron
npm test                 # Vitest: roles, parsers, cliente HTTP, URLs y XSD
npm run build            # instalador (NSIS en Windows)
npm run build:unpacked   # carpeta release/win-unpacked sin instalador
```

**Windows:** electron-builder descarga `winCodeSign` y necesita crear enlaces simbólicos. Sin el
**Modo de desarrollador** de Windows (o una terminal de administrador) falla con "Cannot create
symbolic link". Vite y `tsc` no se ven afectados.

## Pendiente

- Conciliación de un lote en conflicto (ingesta): el contrato no define cómo se resuelve.
- Escritura XML hacia auth, catalog, algorithms-core, income-segmentation y documents: depende de
  que cada dueño acepte cuerpos XML (hoy solo JSON).
- Seguimiento muestra ids de usuario (y "Tú" para el propio): auth-service no deja leer nombres de
  otros usuarios a estos perfiles (D-26).
- Proponer promociones y asignar o evaluar seguimientos: en la web (Pamela).
