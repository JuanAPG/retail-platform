# Sistema de diseño — RetailAnalytics Pro

Fuente de verdad visual del front (`web/`). Los prototipos en `docs/design/prototipos/*.dc.html`
son la referencia pixel a pixel de cada pantalla: leer su `<style>` y su markup antes de construir
o modificar una pantalla. Son prototipos (datos de ejemplo), no código de producción.

## 1. Reglas no negociables

1. **Solo 6 colores** (tabla abajo). Nada de grises, blancos puros, azules, verdes u otros tonos. Se permiten
   transparencias de esos mismos colores (`rgba(112,141,129,.25)`, `rgba(240,236,223,.12)`).
2. **Todo redondeado.** Nunca rectángulos con esquinas rectas: círculos (`rounded-full`) o radios
   grandes (pastillas `rounded-full`, tarjetas 32 px, paneles 40 px, hero 44 px). Aplica también a SVG (`rx`).
3. **Hover en todo lo interactivo**: elevar (`-translate-y-1.5`), borde salvia, escalar o rotar íconos.
   El hover es la guía del usuario.
4. **Sin leyendas ni textos de "cómo funciona".** La interfaz debe ser intuitiva. Etiquetas mínimas.
5. **Pocas gráficas.** Preferir círculos con número, pastillas, barras-pastilla y listas. Nada de dashboards llenos de charts.
6. **Rojo vino = acento terciario + advertencias.** Las advertencias siempre llevan ícono o texto de estado
   (Suspendido, Vencido, Anulada, ERROR, Riesgo) para distinguirse del rojo decorativo.
7. **Accesible**: `<button>`, `<a>`, `<input>` + `<label>` reales; `aria-label` en botones de solo ícono;
   objetivos táctiles ≥ 44 px; contraste ≥ 4.5:1 (el salvia solo lleva texto negro encima).

## 2. Color

| Token | Hex | Uso |
|---|---|---|
| `teal` | `#003C3E` | Principal: barra lateral, héroes, botones primarios, texto de énfasis |
| `salvia` | `#708D81` | Secundario: hover, estados OK, círculos decorativos, texto terciario sobre teal |
| `vino` | `#8E0A0A` | Terciario/acento: saludo, títulos de sección, módulo activo, CTA, contadores, advertencias |
| `arena` | `#F0ECDF` | Superficie: tarjetas, campos, texto claro sobre fondos oscuros |
| `marfil` | `#FAF8F2` | Fondo de página y superficies dentro de tarjetas |
| `tinta` | `#040404` | Texto principal, círculos de contraste |

Composición: fondo marfil → tarjetas arena → bloques fuertes teal → acentos vino → detalles salvia.

## 3. Tipografía

| Rol | Fuente | Uso |
|---|---|---|
| `display` | Young Serif 400 | Solo el título principal de cada pantalla (`h1`: "Catálogo", "Precios"…) y el logo |
| `slab` | Josefin Slab 700 | Textos secundarios: saludo, títulos de sección (`h2`), números de círculos, precios, nombres de producto |
| `data` | Montserrat 500–600, `tabular-nums` | SKU, folios, fechas, precios en listas, porcentajes, contadores |
| `sans` | Figtree 400–700 | Todo el texto de interfaz |

Google Fonts:
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Josefin+Slab:wght@600;700&family=Figtree:wght@400;500;600;700&family=Montserrat:wght@400;500;600;700&display=swap">
```

## 4. Layout base (todas las pantallas excepto Acceso)

```
┌ padding 24 ─────────────────────────────────────────────────────────────┐
│ RAIL 92px   │ HEADER: rol (salvia 14) + "Hola, {nombre}" (slab 30 vino) │
│ teal        │         buscador pastilla 56px + campana circular          │
│ radio 46    ├──────────────────────────────────────────┬─────────────────┤
│ íconos 56px │ COLUMNA CENTRAL (flex-1, gap 24)          │ ASIDE 364–400px │
│ tooltip     │  Hero teal 230–250px radio 44             │  tarjetas arena │
│ al hover    │  + círculos KPI superpuestos y recortados │  radio 40       │
│ avatar abajo│  Chips de filtro / grid de tarjetas       │  colas, detalle │
│ (menú rol)  │  Tarjetas radio 32                        │                 │
└─────────────┴──────────────────────────────────────────┴─────────────────┘
```

- **Rail**: logo círculo arena "ra"; módulos del rol como botones circulares 56px; activo = fondo vino;
  hover = salvia + scale 1.08; tooltip pastilla negra con el nombre y el permiso (`lectura`, `aprueba`, `propone`)
  en salvia; badge vino para pendientes. Avatar al fondo abre menú de perfiles al hover.
- Los módulos del rail salen de la matriz de permisos: un módulo sin acceso **no aparece**.

## 5. Componentes (receta Tailwind con los tokens del §7)

| Componente | Receta |
|---|---|
| Hero | `relative overflow-hidden rounded-hero bg-teal text-arena p-10 h-[240px]` + círculos `absolute rounded-full` (salvia/arena/vino/tinta) con `hover:scale-105 hover:-rotate-3` |
| CTA | `rounded-full bg-vino text-arena h-[52px] px-6 font-bold` + círculo interno arena con "+" que rota 90° al hover |
| Botón primario | `rounded-full bg-teal text-arena h-[54px] px-6 hover:bg-vino` |
| Botón secundario | `rounded-full border-2 border-salvia/60 text-teal hover:bg-salvia hover:text-tinta` |
| Botón circular de acción | `size-11 rounded-full bg-marfil text-teal hover:bg-teal hover:text-arena hover:scale-110`; eliminar → `hover:bg-vino` |
| Chip / filtro | `h-11 px-4 rounded-full bg-arena text-teal border-2 border-transparent hover:border-salvia`; activo `bg-vino text-arena` |
| Pastilla de estado | `rounded-full px-3 py-1 text-xs font-semibold`; OK/Activo `bg-salvia text-tinta`; advertencia `bg-vino text-arena` + ícono |
| Tarjeta | `rounded-card bg-arena p-4 border-2 border-transparent transition hover:-translate-y-1.5 hover:border-salvia hover:shadow-lift`; acciones con `opacity-35 group-hover:opacity-100` |
| Panel lateral | `rounded-panel bg-arena p-6 flex flex-col gap-4`, título `font-slab text-[26px] text-vino` |
| Fila de lista | `rounded-full bg-arena flex items-center gap-3 p-2 pr-4 hover:translate-x-1 hover:border-salvia`; seleccionada `bg-teal text-arena` |
| Cola de aprobación | Fila que se expande (teal) con detalle + botón "Aprobar" arena, "Rechazar" círculo (hover vino) |
| Campo | `h-14 rounded-full bg-arena px-5 border-2 border-transparent hover:border-salvia/60 focus:border-vino` |
| Switch | pista `w-[52px] h-8 rounded-full`, encendido `bg-teal` (o vino en Acceso) |
| Pasos / flujo | círculos 56px unidos por líneas-pastilla; hecho `bg-salvia`, actual `bg-vino` con halo |
| Vacío | contenedor `rounded-panel border-2 border-dashed border-salvia` + círculo con ícono + frase corta |

Íconos: SVG de trazo, `stroke-width 2`, `stroke-linecap/linejoin round`, `fill none`. Nunca emoji.

## 6. Pantallas por rol (ver prototipo correspondiente)

| Rol | Prototipo | Módulos backend |
|---|---|---|
| Público | `Main.dc.html` — login + registro de proveedor | AuthModule |
| Administrador | `Admin.dc.html` — usuarios, zonas/tiendas, verificación de cuentas de proveedor | Users, M02, M03 |
| Gerente de Categoría | `Categoria.dc.html` — catálogo, aprobaciones de alta (RF-12), comparar precios por presentación | M04, M08 |
| Responsable de Precios | `Precios.dc.html` — etiquetas de precio por presentación, cambios propuestos, elasticidad | M08, M11 |
| Proveedor Externo | `Proveedor.dc.html` — vitrina, alta con varias presentaciones, solicitudes, cambio de precio | M04, M08 |
| Analista | `Analista.dc.html` — importar CSV, flujo de la demo, reglas Apriori, segmentos, accesibilidad | M05, M06, M07, M10, M12 |
| Planeador | `Planeador.dc.html` — simulador, comparar escenarios, recomendaciones | M13, M14 |
| Auditor | `Auditor.dc.html` — bitácora inmutable con estado previo/posterior | M15 |

Reglas de negocio que el UI debe respetar:
- Precios, inventario y ventas se muestran **por presentación**, nunca por producto.
- Segmentos de ingreso **por zona agregada**.
- Elasticidad muestra clasificación (elástica / inelástica / unitaria), E, periodo y supuestos.
- Accesibilidad muestra sus 4 factores (precio, ingreso, disponibilidad, básicos), nunca solo precio.
- Cada recomendación muestra qué, por qué, con qué datos e impacto estimado.

## 7. Tokens para `web/tailwind.config.js`

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        teal: '#003C3E',
        salvia: '#708D81',
        vino: '#8E0A0A',
        arena: '#F0ECDF',
        marfil: '#FAF8F2',
        tinta: '#040404',
      },
      fontFamily: {
        display: ['"Young Serif"', 'Georgia', 'serif'],
        slab: ['"Josefin Slab"', 'Rockwell', 'Georgia', 'serif'],
        data: ['Montserrat', 'system-ui', 'sans-serif'],
        sans: ['Figtree', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '32px', panel: '40px', hero: '44px' },
      boxShadow: { lift: '0 22px 30px -22px rgba(0,60,62,.55)' },
    },
  },
  plugins: [],
};
```

`body`: `bg-marfil text-tinta font-sans`. Clases de números/datos: `font-data tabular-nums`.
