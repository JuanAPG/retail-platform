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
| Reportes ejecutivos (ver y descargar PDF/Excel/CSV) | documents-service | consulta | consulta | consulta |

Cada sección muestra en el encabezado el servicio que la alimenta. Todas las tablas se exportan a
CSV y XML (`BotonesExportar`); los reportes se descargan tal cual los arma documents-service.

## XML: qué se envía, qué se recibe y qué se valida

| Servicio | Recibe del escritorio | Responde |
|---|---|---|
| transactions-ingestion-service | **XML** (`objectImport`) y el archivo de ventas adjunto (CSV/JSON/XML `salesFile`) | XML (`ingestion/v1`) |
| auth, catalog, algorithms-core, income-segmentation, decision, documents | **JSON** (no leen XML de entrada) | XML (namespace de cada uno) |

- **En ejecución** (`src/api/xml.ts`, `src/api/httpClient.ts`): cada respuesta debe ser XML bien
  formado, sin DOCTYPE, con la **raíz** y el **namespace** que declara el XSD para esa ruta; un éxito
  en JSON se rechaza. Los errores se leen en XML (`<error>`, con sus campos obligatorios) o en JSON.
  El archivo de ventas XML se revisa antes de subirlo (raíz `salesFile`, namespace, filas).
- **En pruebas** (`test/xsd.test.ts`): validación **completa** contra los XSD de `docs/contratos/` con
  libxml2 (`xmllint-wasm`): las respuestas que la app sabe leer, los ejemplos del contrato de ingesta
  y el XML que la app arma. No se carga el validador en la ventana (pesa ~2 MB de WebAssembly).

## Importar ventas — según contrato en revisión

`transactions-ingestion-service` (3111) se implementó **según el contrato en revisión** (PR #96, rama
`docs/contratos-ingestion-monitoring`). El servicio todavía no existe en ninguna rama, así que se probó
contra el contrato y sus ejemplos, no contra el servicio. La pantalla separa:

1. **Archivo de ventas** (los datos): se adjunta en la parte `file` de un multipart → vista previa.
2. **Mensaje de control**: `objectImport` en XML (importar un objeto del bucket), **confirmar**
   (idempotente: repetirlo no duplica, D-34) y **descartar** (antes de confirmar).

La vista previa muestra los conteos y los errores **por fila** (rechazadas y en conflicto).

## Ambientes y URLs

| Modo | Archivo | URLs |
|---|---|---|
| `npm run dev` / `electron:dev` | `.env.development` | `http://localhost:31xx/` |
| `npm run build:staging` | `.env.staging` | HTTPS, marcadores `*.staging.PENDIENTE-GCP.invalid` |
| `npm run build` | `.env.production` | HTTPS, marcadores `*.PENDIENTE-GCP.invalid` |

Juan Ángel reemplaza los marcadores con las URLs de GCP. El build de staging o producción **se
detiene** si una URL no es `https://`, apunta a un host local o trae puerto, y si el JS generado
contiene un host local con puerto. Variables: ver `.env.example`.

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
- promotion-service (3115, D-39): no existe; el escritorio no lo llama.
- Escritura XML hacia auth, catalog, algorithms-core, income-segmentation, decision y documents:
  depende de que cada dueño acepte cuerpos XML (hoy solo JSON).
