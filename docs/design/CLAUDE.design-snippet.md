## Diseño del front (rama `feature/ui-rediseno`)

- Fuente de verdad visual: `docs/design/DESIGN.md`. Referencia por pantalla: `docs/design/prototipos/<Rol>.dc.html`.
- Antes de crear o modificar cualquier pantalla de `web/`, leer `DESIGN.md` y el prototipo del rol correspondiente.
- Usar solo los tokens de Tailwind (`teal`, `salvia`, `vino`, `arena`, `marfil`, `tinta`, `font-display`,
  `font-slab`, `font-data`, `rounded-card/panel/hero`). Nunca hex sueltos ni colores fuera de la paleta.
- Todo redondeado, hover en todo lo interactivo, sin textos explicativos, pocas gráficas.
- Componentes compartidos en `web/src/components/ui/` (Rail, Header, Hero, Chip, StatusPill, Card, ApprovalQueue, etc.);
  reutilizarlos en vez de duplicar estilos.
- El menú del rail se genera desde la matriz de permisos por rol; un módulo sin acceso no se muestra.
- Pantallas nuevas: mismo layout base (rail + header + columna central + aside) y mismas recetas de componentes.
- Solo cambiar el diseño visual cuando se pida explícitamente; no tocar lógica de backend en esta rama.
