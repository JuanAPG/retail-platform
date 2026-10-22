# Retail Decision — App Desktop (Analistas)

Electron + React + TypeScript + Vite. Pide **siempre XML** a los microservicios
(`Accept: application/xml`); no es una copia del sistema web. Multiplataforma
(Windows/macOS/Linux) vía `electron-builder`.

> Estado al 21-oct-2026 (después del Parcial 2). Responsable: Fernando.

## Cómo correrlo

```bash
cp .env.example .env
npm install
npm run electron:dev
```

Esto levanta Vite en `localhost:5173` y abre la ventana de Electron apuntando a ese dev
server, con hot reload. Necesita los microservicios arriba
(`docker compose -f infra/docker-compose.yml up -d`).

Variables (`.env`):

| Variable | Servicio | Default si no se define |
|---|---|---|
| `VITE_API_BASE_URL` | `auth-service` | `http://localhost:3101/` |
| `VITE_CATALOG_BASE_URL` | `catalog-service` | mismo host, puerto 3102 |
| `VITE_ALGORITHMS_BASE_URL` | `algorithms-core` | mismo host, puerto 3105 |

## Cómo empaquetar (build final)

```bash
npm run build
```

Genera el instalador del sistema operativo donde corras el comando (`.dmg` en macOS,
`.exe`/NSIS en Windows, `.AppImage` en Linux) dentro de `release/`. Para generar los 3
desde una sola máquina se necesita CI multiplataforma; para la demo basta compilar en el
sistema de quien presenta.

## Qué ya funciona

- **Login** contra `auth-service`. Las respuestas llegan en XML y se convierten con
  `fast-xml-parser`; los **cuerpos que se envían van en JSON**, porque los servicios
  solo leen JSON de entrada. Si una respuesta llega en JSON (por ejemplo, un error), el
  cliente la lee igual según su `Content-Type`.
- **Sesión segura:** el token se cifra en el proceso `main` de Electron con
  `safeStorage` (Keychain/DPAPI/libsecret) y React solo lo alcanza mediante
  `window.electronAPI` (`contextBridge`).
- **Mantener sesión:** al reabrir la app se recupera la sesión guardada, se revisa que el
  rol del token coincida, se renueva si está por vencer y se confirma con
  `POST /v1/auth/validate`. Renovación automática un minuto antes de que venza el access
  token y reintento único ante un `401`.
- **Logout** que revoca la sesión en `auth-service` y borra el token cifrado.
- **Menú por rol:** `src/config/menu.ts` es el único lugar que define secciones y roles;
  el menú, las rutas (`RoleRoute`) y la pantalla de inicio leen de ahí. Entran los 6
  perfiles internos; el Proveedor no.
- **Pantallas reales:**

  | Sección | Servicio | Qué hace |
  |---|---|---|
  | Comparar zonas | `catalog-service` | Lista zonas con búsqueda y filtros; compara zonas lado a lado (`GET /v1/zones/compare`). Exporta CSV y XML. |
  | Segmentos de ingreso | `catalog-service` | Tabla con búsqueda; alta, edición y baja de segmentos. Exporta CSV y XML. |
  | Reglas de asociación | `algorithms-core` | Ejecuta **Apriori**, lista las corridas guardadas y abre el detalle con sus reglas; búsqueda por producto. |

## Qué falta

Cobertura de los RF de escritorio (`docs/requerimientos.md` §1.8):

| RF | Qué pide | Estado |
|---|---|---|
| RF-41 | Autenticación de analistas | Hecho. Qué roles usan la app: **PENDIENTE P-04**. |
| RF-42 | Importar ventas | Pantalla pendiente (sección `/ventas` sin implementar). Por **D-33** la importación por archivo vive en `transactions-ingestion-service` (3111), no en core-process: la pantalla se hace contra ese servicio. |
| RF-43 | Configurar segmentos | Hecho contra `catalog-service`. Por **D-35** los segmentos pasan a `income-segmentation-service` (3112, con versiones): hay que cambiar `segmentsApi.ts` cuando ese servicio exista. |
| RF-44 | Ejecutar reglas de asociación | Hecho solo con Apriori; falta FP-Growth (`POST /v1/association/fpgrowth/run`, D2) y exportar las reglas. |
| RF-45 | Analizar elasticidad | Pantalla pendiente. El Analista solo tiene Lectura en Elasticidad: **PENDIENTE P-04**. |
| RF-46 | Comparar zonas | Hecho. |
| RF-47 | Simular empaque y descuentos | Sin sección en el menú. La simulación es Total solo del Planeador: **PENDIENTE P-04**. |
| RF-48 | Exportar tablas y reportes | Parcial: CSV y XML locales en zonas y segmentos; reportes de `documents-service`, no. |

Requisitos del profesor que todavía no se cumplen (`docs/requerimientos.md` §3):

- **Validación con XSD:** los XSD ya existen en `docs/contratos/*.xsd`, pero la app solo
  parsea el XML y no lo valida contra ellos.
- **≥ 4 microservicios:** hoy consume 3 (`auth-service`, `catalog-service`,
  `algorithms-core`). El cuarto llega con la pantalla de importar ventas o con la de
  elasticidad o simulación.

Diferencia conocida con la Matriz (§3): `puedeEscribir()` en `src/config/menu.ts` deja
ejecutar Apriori y editar segmentos al **Administrador** y al Analista, pero la Matriz le da
al Administrador solo **Lectura** en ambos módulos. Los servicios responden `403`, pero los
botones no deberían mostrarse.

## Por qué XML y no "la web pero de escritorio"

Esta app no es una copia del sistema web: el enfoque es analista (ejecutar algoritmos,
comparar resultados, exportar), no captura de datos del día a día. Por eso el menú y las
pantallas son distintos a los del sistema web, aunque compartan microservicios.
