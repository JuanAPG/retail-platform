# Convenciones del equipo

## Arquitectura: monolito modular

Todo el backend vive en **un solo proyecto NestJS** (`api/`). Cada módulo de negocio es
una carpeta bajo `api/src/`.

**No se crean microservicios ni carpetas `*-service`.** La extracción se decide hasta el
Parcial 2 y solo para los módulos que la justifiquen. Si algo parece "más limpio"
separado, no lo separes: es una decisión de equipo tomada a propósito.

## Reparto de módulos y ramas

| Módulo | Carpeta en `api/src/` | Responsable | Rama |
|---|---|---|---|
| M02 Tiendas | `stores/` | Pamela | `feature/m02-tiendas` |
| M03 Zonas | `zones/` | Pamela | `feature/m03-zonas` |
| M04 Productos y presentaciones | `products/` | Pamela | `feature/m04-productos` |
| M05 Segmentos de ingreso | `segments/` | Pamela | `feature/m05-segmentos` |
| M06 Transacciones + CSV | `transactions/` | Juan Angel | `feature/m06-transacciones` |
| M07 Canastas | `baskets/` | Fernando | `feature/m07-canastas` |
| M08 Precios | `prices/` | Pamela | `feature/m08-precios` |
| M09 Analítica descriptiva | `analytics/` | Leonardo | `feature/m09-analitica` |
| M10 Asociación (Apriori) | `association/` | Leonardo | `feature/m10-asociacion` |
| M11 Elasticidad y sustitución | `elasticity/` | Leonardo | `feature/m11-elasticidad` |
| M12 Accesibilidad | `accessibility/` | Fernando | `feature/m12-accesibilidad` |
| M13 Simulación | `simulation/` | Fernando | `feature/m13-simulacion` |
| M14 Recomendaciones | `recommendations/` | Fernando | `feature/m14-recomendaciones` |
| M15 Auditoría | `audit/` | Juan Angel | `feature/m15-auditoria` |

Cada `*.module.ts` ya tiene documentado su alcance y sus reglas de negocio. Léelo antes
de empezar: ahí están las restricciones que el profesor va a revisar.

## Cómo arrancar tu módulo

Tu módulo ya existe, está vacío y **ya está registrado** en `app.module.ts`. Dentro de tu
carpeta creas lo que necesites:

```
api/src/<tu-modulo>/
├── <tu-modulo>.module.ts      # ya existe: agrega imports/controllers/providers aquí
├── <tu-modulo>.controller.ts
├── <tu-modulo>.service.ts
└── dto/
```

Y su pantalla correspondiente en `web/src/pages/`.

## Archivos compartidos: coordinar antes de tocar

Estos son los que provocan conflictos si dos personas los editan a la vez. No están
prohibidos, pero **avisa en el chat del equipo antes**:

| Archivo | Por qué |
|---|---|
| `api/src/app.module.ts` | **No debería hacer falta tocarlo.** Los 14 módulos ya están registrados. Si crees que lo necesitas, pregunta primero |
| `api/src/entities/` | Una entidad por tabla, compartida. Agrega la tuya; no modifiques las ajenas |
| `api/src/common/` | Guards, decoradores y `roles.ts`. Cambiar un nombre de rol afecta a todos |
| `db/schema.sql` | Ver abajo |
| `web/src/App.tsx` y `web/src/routes/` | Rutas y mapa de portales |
| `web/src/api/catalogo.ts` | Agrupa las llamadas de M02, M03 y M04. Si crece, pártelo por módulo |
| `web/src/types/index.ts` | Interfaces calcadas de las entidades del backend |

## Cambios al esquema de la base de datos

TypeORM corre con `synchronize: false` **a propósito**: nadie quiere que el arranque de
la app altere tablas solo. El DDL de `db/schema.sql` es la fuente de verdad.

Si tu módulo necesita una tabla nueva:

1. Agrega el `CREATE TABLE` a `db/schema.sql`.
2. Agrega los datos mínimos de prueba a `db/data_retail.sql`, con `ON CONFLICT ... DO
   NOTHING` para que el archivo se pueda volver a ejecutar sin duplicar nada.
3. Crea la entidad TypeORM en `api/src/entities/`, con los nombres de columna reales
   (`@Column({ name: 'snake_case' })`).
4. **Avísale al equipo**, porque los demás tienen que recrear su base:
   `docker compose -f infra/docker-compose.yml down -v && ... up -d`.

El `initdb` de Postgres solo corre cuando el volumen se crea desde cero: cambiar el SQL
sin borrar el volumen no hace nada.

## Modelo de datos: lo que cambió al normalizar (esquema v3)

Si tu módulo toca el catálogo, lee esto antes de escribir consultas:

- **El precio, el inventario y las líneas de venta cuelgan de la PRESENTACIÓN**
  (`producto_presentaciones`), no del producto. `productos` ya no tiene
  `unidad_medida`.
- **`transacciones_detalle` guarda `presentacion_id`, no `producto_id`.** El producto
  sale por join; guardar los dos permitiría que se contradijeran. Usa la vista
  `v_transaccion_detalle`, que ya entrega ambos.
- **`tiendas.direccion` ya no existe**: es `direccion_id` → tabla `direcciones`.
  `tiene_web_propia` tampoco: si hay fila en `tienda_canal_web`, tiene web.
- **`zonas` ya no guarda segmento ni clustering.** La clasificación vigente está en
  `zona_clasificaciones` (`WHERE vigente`), y las medidas —ingreso estimado, población,
  disponibilidad— en `indicador_valores`.
- **Los indicadores son filas, no columnas.** Para agregar uno, inserta en `indicadores`
  y escribe en `indicador_valores`. Nunca un `ALTER TABLE`.
- **Toda salida calculada necesita una corrida.** Crea primero un `analisis_corridas`
  con su periodo, sus parámetros y sus supuestos, y cuelga el resultado de ahí. Sin eso
  el resultado no es reproducible y el requerimiento lo exige explícitamente.
- **La auditoría es append-only** y sus campos modificados van en `auditoria_cambios`,
  no en un JSON.

## Reglas de permisos

- Usa las constantes de `api/src/common/roles.ts`, **nunca literales**. Un acento
  distinto compila igual y abre un hueco silencioso.
- Un método sin `@Roles()` queda abierto a cualquier usuario autenticado. Es el default;
  decídelo a conciencia.
- El recorte por dueño del dato va en la consulta SQL, no en el frontend. Filtrar en el
  navegador es cosmético: la respuesta HTTP sigue trayendo todo.
- Cualquier cambio a la matriz de perfiles debe reflejarse en
  `docs/matriz-perfiles-permisos.docx` (avisar al equipo; no se edita automáticamente).

## Flujo de trabajo paso a paso

### Una sola vez, al empezar

```bash
git clone https://github.com/JuanAPG/retail-platform.git
cd retail-platform

# Que tus commits salgan a TU nombre. El profesor revisa esto.
git config user.name  "Tu Nombre Completo"
git config user.email "tu-correo-de-github@ejemplo.com"
git config --get user.email     # verifica antes del primer commit
```

### Cada vez que empiezas algo

```bash
# 1. Parte SIEMPRE de main actualizado. Ramificar de una rama vieja es
#    la causa número uno de conflictos gigantes al final.
git checkout main
git pull origin main

# 2. Crea tu rama con el nombre que te toca (ver tabla de arriba)
git checkout -b feature/m06-transacciones

# 3. Trabaja. Commits pequeños y frecuentes, no uno gigante al final.
git add api/src/transactions web/src/pages/TransaccionesPage.tsx
git commit -m "feat(m06): valida el formato del CSV antes de insertar"

# 4. Sube tu rama (la primera vez con -u; después basta `git push`)
git push -u origin feature/m06-transacciones
```

Luego abre el Pull Request en GitHub: **Compare & pull request** → base `main`,
compare tu rama.

### Mantener tu rama al día

Mientras tú trabajas, otros mergean a `main`. Trae esos cambios cada dos o tres días:

```bash
git checkout main
git pull origin main
git checkout feature/m06-transacciones
git merge main
git push
```

Se usa `merge` y no `rebase` a propósito: `rebase` reescribe la historia y obliga a
`push --force`, que si alguien más ya bajó tu rama le destruye el trabajo. Con `merge`
eso no puede pasar. Si aparece un conflicto:

```bash
# Edita los archivos marcados con <<<<<<< y >>>>>>>, quédate con lo correcto
git add <archivo-resuelto>
git commit          # cierra el merge
git push
```

### Después de que aprueben tu PR

Mergea desde GitHub (botón **Merge pull request**) y limpia:

```bash
git checkout main
git pull origin main
git branch -d feature/m06-transacciones          # borra la local
```

La rama remota se borra sola si está activado *Automatically delete head branches*.

### Regla de oro para no estorbarse

Toca **solo tu carpeta** de `api/src/` y tu pantalla de `web/src/pages/`. Los archivos
compartidos están listados abajo: avisa antes de tocarlos. Si necesitas algo de un
módulo ajeno que aún no existe, no lo escribas tú — pídelo en el chat del equipo.

## Ramas (GitHub Flow)

- `main` siempre desplegable, protegida (requiere PR + 1 aprobación)
- Ramas de trabajo: `feature/mXX-nombre`, `fix/nombre-corto`, `docs/nombre-corto`
- Se borran al hacer merge
- Actualiza tu rama con `main` cada dos o tres días: mientras más tiempo pase, más caro
  el merge
- Una rama = un módulo = un PR. No mezcles dos módulos en la misma rama

## Commits (Conventional Commits)

```
feat:     nueva función
fix:      corrección de bug
docs:     solo documentación
chore:    config, dependencias, sin cambio de lógica
refactor: cambio de código sin alterar comportamiento
```

Ejemplo: `feat(m06): importación de transacciones desde CSV`

**Cada quien hace commits con su propia cuenta de Git.** Commits atribuidos a otra
identidad, o documentación sin commits de código real, no cuentan como participación —
esto ya generó observaciones del profesor en el primer avance. Verifica con:

```bash
git config user.name && git config user.email
```

## Pull Requests

- Título claro con el módulo: `feat(m06): importación de transacciones por CSV`
- Descripción de qué y por qué, y cómo probarlo (con qué usuario entrar y qué debe verse)
- Ligar el PR a la tarea del Sprint Backlog
- **Mínimo 1 aprobación** antes de mergear a `main`. Nadie aprueba su propio PR
- El CI (`.github/workflows/ci.yml`) tiene que pasar en verde
- Antes de abrirlo, que compile en local:

```bash
cd api && npm run build
cd ../web && npm run build
```

### Al revisar el PR de alguien más

No es trámite: es la única red que tiene el equipo hasta que existan pruebas.

- Descarga la rama y córrela (`git checkout feature/mXX-...`), no solo leas el diff
- Revisa que no haya tocado carpetas de otros módulos ni `app.module.ts`
- Si agregó tablas, que también estén en `db/schema.sql` y `db/data_retail.sql`
- Comenta lo que veas raro; aprobar sin leer no cuenta como participación

## Configuración del repositorio (una vez, la hace el dueño del repo)

En GitHub → **Settings**:

1. **Branches → Add branch protection rule**, patrón `main`:
   - *Require a pull request before merging* → *Require approvals*: **1**
   - *Require status checks to pass before merging* → selecciona los checks
     `build (api)` y `build (web)`
   - *Require branches to be up to date before merging*
2. **General → Pull Requests → Automatically delete head branches**

Los status checks **no aparecen en esa lista hasta que el workflow corrió al menos una
vez**. Si no los ves, abre un PR de prueba primero, deja que corra el CI, y regresa a
configurar la protección.

## Verificación local rápida

```bash
docker compose -f infra/docker-compose.yml up -d postgres pgadmin api web
docker compose -f infra/docker-compose.yml logs -f api
```

Front en http://localhost:5173, API y Swagger en http://localhost:3001/docs.
Credenciales de prueba en [web/README.md](web/README.md).
