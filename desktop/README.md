# Retail Decision — App Desktop (Analistas)

Electron + React + TypeScript + Vite. Habla EXCLUSIVAMENTE XML con los microservicios (`auth-service`, `core-process-service`, `algorithms-core`, `catalog-service`). Multiplataforma (Windows/macOS/Linux) vía `electron-builder`, cumpliendo RNF-16.

## Cómo correrlo

```bash
cp .env.example .env
npm install
npm run electron:dev
```

Esto levanta Vite en `localhost:5173` y abre la ventana de Electron apuntando a ese dev server, con hot reload.

## Cómo empaquetar (build final)

```bash
npm run build
```

Genera el instalador correspondiente al sistema operativo donde corras el comando (`.dmg` en macOS, `.exe`/NSIS en Windows, `.AppImage` en Linux) dentro de `release/`. Para generar los 3 desde una sola máquina se necesita CI multiplataforma (GitHub Actions, por ejemplo) — para la entrega de clase probablemente baste con compilar en el sistema operativo de quien presenta la demo.

## Qué ya funciona

- Login contra `auth-service`, mandando y recibiendo **XML** (el `httpClient` fuerza `Accept`/`Content-Type: application/xml` y convierte con `fast-xml-parser` en ambas direcciones).
- Sesión guardada de forma segura: el token nunca toca el proceso de React (`renderer`) en disco — se cifra en el proceso `main` de Electron con `safeStorage` (usa Keychain/DPAPI/libsecret del sistema operativo) y se expone solo mediante `window.electronAPI` vía `contextBridge`.
- Recuperar sesión al reabrir la app (equivalente a "mantener sesión").
- Logout que limpia el token cifrado.
- Manejo de error estandarizado (mismo formato `{statusCode, message, code, ...}` que ya usa decision-service), venga en XML.

## Qué falta (próximos incrementos)

- Pantalla real de analista: importar archivo de ventas, configurar segmentos de ingreso, correr Apriori/FP-Growth, ver elasticidad, comparar zonas, simular empaques.
- Validación XSD de los XML que entran/salen (pendiente definir el .xsd con el equipo).
- Tabla de resultados con búsqueda/filtros.
- Exportación simple CSV/XML.
- Menú según rol (falta un endpoint `whoami` en `auth-service` para repoblar el rol al recuperar sesión guardada).

## Por qué XML y no "la web pero de escritorio"

Esta app no es una copia del sistema web: el enfoque es analista (ejecutar algoritmos, comparar resultados, exportar), no captura de datos del día a día. Por eso el menú y las pantallas van a ser distintos a los del sistema web, aunque compartan microservicios.
