-- =====================================================================
-- Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista
-- Esquema relacional (PostgreSQL 16) — v4
--
-- =====================================================================
-- v4: DE 1FN A 4FN
--
-- La v3 ya había separado los atributos multivaluados (presentaciones,
-- imágenes, ítems de reglas, parámetros, supuestos, filtros), así que NO
-- había dependencias multivaluadas que descomponer: la 4FN no se alcanza
-- partiendo tablas, sino cerrando los defectos de 2FN, 3FN y FNBC que
-- quedaban y dándole llave real a las tablas que no la tenían (sin llave
-- verificable, hablar de forma normal no significa nada).
--
--  A. 2FN — `accesibilidad_componentes.peso` dependía de `componente`,
--     que es solo PARTE de la llave (accesibilidad_id, componente): el
--     peso es del MODELO, no de la zona. Se repetía idéntico en cada
--     zona de la corrida. Pasó a `accesibilidad_pesos(corrida, comp)`.
--
--  B. FNBC — `direcciones`: `codigo_postal -> municipio_id` es una
--     dependencia funcional cuyo determinante no es llave candidata.
--     Dos direcciones con el mismo CP podían declarar municipios
--     distintos. El CP pasó a ser catálogo: `codigos_postales`.
--
--  C. FNBC — `zona_clasificaciones`: `(corrida_id, cluster_valor) ->
--     segmento_ingreso_id`. Todas las zonas del cluster 3 de una corrida
--     caen en el mismo segmento; el determinante no es llave. El mapeo
--     cluster→segmento pasó a `corrida_clusters`.
--
--  D. 3FN — `elasticidades.clasificacion` estaba determinada por
--     `valor` (no-llave -> no-llave). Ahora es columna GENERADA: la
--     redundancia deja de ser posible en vez de solo estar vigilada.
--
--  E. 3FN — `canastas.tamano` estaba determinado por `valor_total`
--     (umbrales de RN-05 escondidos en el código de carga). El umbral
--     pasó al catálogo `tamanos_compra` y el tamaño se resuelve en
--     `v_canastas`. Cambiar el criterio ya no es un ALTER TABLE.
--
--  F. 3FN — `precios.vigente` y `zona_clasificaciones.vigente` eran
--     banderas que podían contradecir a las fechas de vigencia. Ahora se
--     generan de `fecha_vigencia_hasta` / `vigente_hasta`.
--
--  G. 3FN — `indicador_valores` admitía `producto_id` y `categoria_id`
--     a la vez (producto -> categoría es transitiva) y `tienda_id` con
--     `zona_id` (tienda -> zona). Además NO tenía llave: la misma
--     medición podía insertarse mil veces. Se cerró con CHECKs de
--     dimensión y una UNIQUE NULLS NOT DISTINCT.
--
--  H. Llaves que no cerraban: `elasticidades`, `sustituciones`,
--     `limites_precio_zona` y `escenario_resultados` declaraban UNIQUE
--     sobre columnas nulables. En SQL dos NULL son distintos, así que la
--     restricción NO impedía duplicados justo en el caso agregado
--     (zona NULL). Ahora son UNIQUE NULLS NOT DISTINCT (PG 15+).
--
--  I. `reglas_exclusion_asociacion` admitía (A,B) y (B,A) como filas
--     distintas siendo el mismo hecho simétrico. Se canoniza con
--     CHECK (categoria_a_id < categoria_b_id).
--
-- LO QUE **NO** SE TOCÓ, Y POR QUÉ (denormalización deliberada, no
-- violación de forma normal — la redundancia entre tablas distintas no
-- es lo que miden las formas normales; estas columnas dependen por
-- completo de la llave de SU tabla):
--   · `canastas` congela zona y segmento: reclasificar una zona hoy no
--     debe reescribir el análisis de meses pasados. Es un hecho
--     histórico distinto del actual, no una copia.
--   · `canastas.valor_total`/`numero_productos`/… y `transacciones.total`
--     e `importaciones.filas_*` son agregados materializados a propósito
--     (el tablero consulta millones de líneas).
--   · `auditoria.rol_id` es el rol VIGENTE EN EL INSTANTE del evento; el
--     rol del usuario puede cambiar después, así que no es derivable.
--   · `productos.estatus` es el estado actual; el historial completo de
--     decisiones vive en `producto_revisiones`.
--
-- Queda pendiente (requiere trigger, no se puede expresar como CHECK):
--   · que las dimensiones llenadas en `indicador_valores` correspondan
--     al `ambito` declarado del indicador;
--   · que los pesos de `accesibilidad_pesos` de una corrida sumen 1.
-- =====================================================================
--
-- Cambio de v2 a v3: NORMALIZACIÓN. El profesor observó que
-- varias tablas concentraban demasiados atributos. Lo que se corrigió:
--
--  1. `tiendas.direccion` era un TEXT con una dirección completa dentro
--     (calle, número, colonia, CP). Ahora es la tabla `direcciones`.
--  2. `tiendas.tiene_web_propia` + `gestion_datos_web`: el segundo campo
--     solo tiene sentido si el primero es TRUE. Un atributo que depende
--     de otro atributo (y no de la llave) no pertenece a la tabla: pasó
--     a `tienda_canal_web`.
--  3. `productos.unidad_medida` obligaba a un producto = una sola
--     presentación. Ahora `producto_presentaciones` (RF-35): un producto
--     tiene 500 g, 1 kg, etc. Precios, inventario y líneas de venta se
--     registran contra la PRESENTACIÓN, no contra el producto.
--  4. `productos.aprobado_por` y `motivo_rechazo` describen un EVENTO de
--     revisión, no al producto. Pasaron a `producto_revisiones`, que
--     además conserva el historial de propuestas y rechazos.
--  5. `zonas` guardaba ingreso, clustering y clasificación como columnas.
--     Son medidas que cambian con el tiempo: pasaron a
--     `zona_clasificaciones` (historial) y `zona_indicadores` (serie).
--  6. Los indicadores calculados (ticket promedio, productos por
--     canasta, gasto por categoría…) NO son columnas: son filas de
--     `indicador_valores`, referidas a un catálogo `indicadores`. Así se
--     agrega un indicador nuevo sin ALTER TABLE.
--  7. Toda salida analítica cuelga de `analisis_corridas`, que conserva
--     datos usados, periodo, fecha, usuario, parámetros y supuestos.
--  8. El antecedente de una regla de asociación es un CONJUNTO de
--     productos, no un texto: `regla_asociacion_items` (1FN).
--
-- Este archivo define únicamente estructura (DDL). Los datos de prueba
-- están en `data_retail.sql`.
--
-- CONSTRUCCIÓN DESDE CERO. El archivo arranca borrando todos sus
-- objetos (ver bloque LIMPIEZA) y los vuelve a crear, todo dentro de una
-- misma transacción. Se puede reejecutar cuantas veces haga falta sin
-- destruir el volumen de Docker, y si algo falla a medio camino la
-- transacción se revierte entera: nunca queda un esquema a medias.
--
-- No es un script de migración: no conserva datos ni intenta detectar
-- qué cambió respecto a la versión anterior. Para el entorno de
-- desarrollo del equipo eso es lo que queremos; llegado el momento de
-- tener datos que no se puedan perder, el mecanismo tendrá que ser otro
-- (migraciones versionadas).
--
-- Sólo queda UN `ALTER TABLE` en todo el archivo, y es inevitable:
-- `transacciones` e `importacion_filas` se referencian mutuamente, así
-- que una de las dos llaves foráneas se cierra después de crear ambas
-- tablas. Está señalado en su lugar.
--
-- Decisión de alcance vigente: TODO el modelo analítico vive en
-- PostgreSQL. MongoDB y Redis quedan fuera hasta el Parcial 2.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- LIMPIEZA: este archivo construye la base DESDE CERO.
--
-- No es un script de migración y no intenta conservar nada: borra todos
-- sus objetos y los vuelve a crear. Así se puede reejecutar sobre una
-- base ya inicializada sin tener que destruir el volumen de Docker.
--
--   docker compose exec -T postgres \
--       psql -U postgres -d retail_analytics < db/schema.sql
--
-- CASCADE se encarga de vistas, índices, restricciones y disparadores
-- que cuelguen de cada objeto; los DROP VIEW explícitos van primero
-- solo para dejar constancia de qué vistas define el esquema.
--
-- ADVERTENCIA: esto BORRA LOS DATOS. En desarrollo es lo que queremos
-- (los datos de prueba se recargan con data_retail.sql). Nunca se
-- ejecuta contra un entorno con información real.
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS
    v_direcciones, v_zona_segmento, v_zona_indicadores,
    v_transaccion_detalle, v_canastas, v_accesibilidad_desglose,
    v_dashboard_kpis_generales, v_dashboard_gasto_categoria,
    v_dashboard_asociaciones, v_dashboard_accesibilidad_zona,
    v_dashboard_elasticidad, v_variacion_precios, v_dashboard_simulacion
CASCADE;

DROP TABLE IF EXISTS
    roles, modulos, rol_modulo_permiso, municipios, codigos_postales,
    direcciones, proveedores, usuarios, analisis_corridas,
    analisis_corrida_parametros, analisis_corrida_supuestos,
    analisis_corrida_filtros, segmentos_ingreso, corrida_clusters, zonas,
    zona_clasificaciones, indicadores, tiendas, tienda_canal_web,
    categorias_producto, unidades_medida, productos, indicador_valores,
    producto_presentaciones, producto_imagenes, producto_revisiones,
    inventario, precios, precios_propuestos_proveedor, limites_precio_zona,
    reglas_exclusion_asociacion, clientes, importaciones,
    importacion_filas, importacion_errores, transacciones,
    transacciones_detalle, tamanos_compra, canastas, reglas_asociacion,
    regla_asociacion_items, sustituciones, elasticidades,
    accesibilidad_zona, accesibilidad_pesos, accesibilidad_componentes,
    escenarios, escenario_cambios, escenario_resultados, recomendaciones,
    recomendacion_evidencias, auditoria, auditoria_cambios
CASCADE;

DROP TYPE IF EXISTS
    nivel_permiso, tipo_corrida, estado_corrida, dimension_analisis,
    ambito_indicador, formato_tienda, tipo_unidad, estatus_producto,
    origen_precio, estatus_propuesta, perfil_hogar, frecuencia_compra,
    estado_importacion, severidad_error, canal_transaccion, tamano_compra,
    lado_regla, tipo_sustitucion, clasificacion_elasticidad,
    componente_accesibilidad, tipo_cambio_escenario, estatus_recomendacion,
    accion_auditoria
CASCADE;

DROP FUNCTION IF EXISTS set_updated_at() CASCADE;

-- ---------------------------------------------------------------------
-- CONSTRUCCIÓN
-- ---------------------------------------------------------------------

-- gen_random_uuid() es nativa desde PostgreSQL 13; no hace falta pgcrypto.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 1. ROLES, MÓDULOS Y PERMISOS
-- =====================================================================

CREATE TABLE roles (
    id              SMALLSERIAL PRIMARY KEY,
    nombre          VARCHAR(40)  NOT NULL UNIQUE,
    descripcion     TEXT         NOT NULL
);
COMMENT ON TABLE roles IS 'Perfiles del sistema (S0_Matriz_de_Perfiles_y_Permisos).';

CREATE TABLE modulos (
    id              SMALLSERIAL PRIMARY KEY,
    clave           VARCHAR(10)  NOT NULL UNIQUE,   -- 'M06', 'M15'…
    nombre          VARCHAR(60)  NOT NULL UNIQUE,
    descripcion     TEXT
);
COMMENT ON TABLE modulos IS 'Módulos del sistema; la clave empata con las carpetas de api/src.';

CREATE TYPE nivel_permiso AS ENUM (
    'total', 'lectura_actualiza', 'lectura', 'propone',
    'aprueba', 'lectura_propios', 'sin_acceso'
);

CREATE TABLE rol_modulo_permiso (
    rol_id          SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    modulo_id       SMALLINT NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
    nivel           nivel_permiso NOT NULL DEFAULT 'sin_acceso',
    PRIMARY KEY (rol_id, modulo_id)
);
COMMENT ON TABLE rol_modulo_permiso IS 'Matriz de permisos rol x módulo (RBAC dirigido por datos).';

-- =====================================================================
-- 2. TERRITORIO Y DIRECCIONES
-- =====================================================================

CREATE TABLE municipios (
    id              SMALLSERIAL PRIMARY KEY,
    nombre          VARCHAR(80) NOT NULL UNIQUE
);
COMMENT ON TABLE municipios IS 'Municipios del AMM usados como base territorial (RN-02).';

-- FNBC (v4). Un código postal pertenece a un solo municipio: en
-- `direcciones` existía la dependencia funcional
--     codigo_postal -> municipio_id
-- cuyo determinante NO es llave candidata de la tabla. Consecuencia
-- práctica: dos direcciones con CP 64000 podían declarar municipios
-- distintos y la base no tenía cómo impedirlo. El CP se vuelve catálogo.
CREATE TABLE codigos_postales (
    codigo_postal   VARCHAR(10) PRIMARY KEY,
    municipio_id    SMALLINT NOT NULL REFERENCES municipios(id),
    CONSTRAINT chk_cp_formato CHECK (codigo_postal ~ '^[0-9]{5}$')
);
COMMENT ON TABLE codigos_postales IS 'Catálogo CP -> municipio (SEPOMEX). Elimina la dependencia funcional que rompía FNBC en direcciones.';

CREATE INDEX idx_cp_municipio ON codigos_postales(municipio_id);

-- Antes esto era `tiendas.direccion TEXT`. Una dirección es un dato
-- compuesto: guardarla como una sola cadena impide agrupar por colonia
-- o por código postal, que es justo lo que necesita el análisis por zona.
-- Ya no guarda el municipio: se obtiene por el CP (ver v_direcciones).
CREATE TABLE direcciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calle               VARCHAR(150) NOT NULL,
    numero_exterior     VARCHAR(20),
    numero_interior     VARCHAR(20),
    colonia             VARCHAR(120),
    codigo_postal       VARCHAR(10) NOT NULL REFERENCES codigos_postales(codigo_postal),
    referencia          TEXT,
    latitud             NUMERIC(9,6),
    longitud            NUMERIC(9,6),
    CONSTRAINT chk_direccion_lat CHECK (latitud  IS NULL OR latitud  BETWEEN -90  AND 90),
    CONSTRAINT chk_direccion_lon CHECK (longitud IS NULL OR longitud BETWEEN -180 AND 180)
);
COMMENT ON TABLE direcciones IS 'Domicilio normalizado. Reutilizable por tiendas y, más adelante, por proveedores. El municipio se deriva del código postal.';

CREATE INDEX idx_direcciones_cp ON direcciones(codigo_postal);

-- El municipio sigue siendo consultable como antes, ahora por join.
CREATE VIEW v_direcciones AS
SELECT d.id, d.calle, d.numero_exterior, d.numero_interior, d.colonia,
       d.codigo_postal, cp.municipio_id, m.nombre AS municipio,
       d.referencia, d.latitud, d.longitud
FROM direcciones d
JOIN codigos_postales cp ON cp.codigo_postal = d.codigo_postal
JOIN municipios m ON m.id = cp.municipio_id;
COMMENT ON VIEW v_direcciones IS 'Dirección con municipio resuelto. Sustituye a la columna direcciones.municipio_id que rompía FNBC.';

-- =====================================================================
-- 3. PROVEEDORES Y USUARIOS
-- =====================================================================

CREATE TABLE proveedores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    razon_social    VARCHAR(150) NOT NULL,
    rfc             VARCHAR(20)  UNIQUE,
    contacto_nombre VARCHAR(120),
    email           VARCHAR(150) NOT NULL UNIQUE,
    telefono        VARCHAR(30),
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE proveedores IS 'Empresas proveedoras externas (RN-14).';

CREATE TRIGGER trg_proveedores_updated_at
    BEFORE UPDATE ON proveedores
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE usuarios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre          VARCHAR(120) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    rol_id          SMALLINT     NOT NULL REFERENCES roles(id),
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_usuarios_email_formato CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
COMMENT ON TABLE usuarios IS 'Usuarios internos y externos (proveedores) del sistema.';

CREATE TRIGGER trg_usuarios_updated_at
    BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_usuarios_rol ON usuarios(rol_id);

-- =====================================================================
-- 4. TRAZABILIDAD ANALÍTICA
--    Toda salida calculada (indicadores, Apriori, elasticidad,
--    accesibilidad, simulación) cuelga de una corrida. Es lo que
--    permite responder "¿con qué datos, en qué periodo, quién y bajo
--    qué supuestos se obtuvo esto?" sin adivinar.
-- =====================================================================

CREATE TYPE tipo_corrida AS ENUM (
    'descriptiva',      -- M09 indicadores de tamaño y frecuencia de compra
    'clasificacion_zona', -- M05 clustering / segmentación de zonas
    'asociacion',       -- M10 Apriori / FP-Growth
    'sustitucion',      -- M11 patrones de sustitución
    'elasticidad',      -- M11 elasticidad precio-demanda
    'accesibilidad',    -- M12
    'simulacion'        -- M13
);

CREATE TYPE estado_corrida AS ENUM ('en_proceso','completada','fallida');

CREATE TABLE analisis_corridas (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo                        tipo_corrida NOT NULL,
    estado                      estado_corrida NOT NULL DEFAULT 'en_proceso',
    ejecutada_por               UUID REFERENCES usuarios(id),
    ejecutada_en                TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Periodo de los DATOS analizados, no de la ejecución.
    periodo_inicio              DATE NOT NULL,
    periodo_fin                 DATE NOT NULL,
    -- Tamaño del dataset: hace reproducible y auditable el resultado.
    transacciones_consideradas  INTEGER,
    canastas_consideradas       INTEGER,
    mensaje_error               TEXT,
    CONSTRAINT chk_corrida_periodo CHECK (periodo_fin >= periodo_inicio),
    CONSTRAINT chk_corrida_error CHECK (
        (estado = 'fallida' AND mensaje_error IS NOT NULL) OR estado <> 'fallida'
    )
);
COMMENT ON TABLE analisis_corridas IS 'Corrida de análisis: quién, cuándo, sobre qué periodo y con qué resultado. RF-15 exige poder reproducir una corrida de Apriori completa.';

CREATE INDEX idx_corridas_tipo_fecha ON analisis_corridas(tipo, ejecutada_en DESC);

-- Parámetros como filas, no como JSON: se pueden consultar, comparar
-- entre corridas y validar. Ej. ('soporte_minimo','0.05').
CREATE TABLE analisis_corrida_parametros (
    corrida_id      UUID NOT NULL REFERENCES analisis_corridas(id) ON DELETE CASCADE,
    clave           VARCHAR(60) NOT NULL,
    valor           TEXT NOT NULL,
    PRIMARY KEY (corrida_id, clave)
);
COMMENT ON TABLE analisis_corrida_parametros IS 'Parámetros de entrada de la corrida (soporte, confianza, k, etc.).';

CREATE TABLE analisis_corrida_supuestos (
    corrida_id      UUID NOT NULL REFERENCES analisis_corridas(id) ON DELETE CASCADE,
    orden           SMALLINT NOT NULL,
    supuesto        TEXT NOT NULL,
    PRIMARY KEY (corrida_id, orden)
);
COMMENT ON TABLE analisis_corrida_supuestos IS 'Supuestos declarados de la corrida. Obligatorio para elasticidad y accesibilidad: sin ellos el número no es interpretable.';

CREATE TYPE dimension_analisis AS ENUM ('tienda','zona','segmento','categoria','producto');

-- "Datos usados": sobre qué subconjunto se corrió el análisis.
CREATE TABLE analisis_corrida_filtros (
    corrida_id      UUID NOT NULL REFERENCES analisis_corridas(id) ON DELETE CASCADE,
    dimension       dimension_analisis NOT NULL,
    referencia_id   TEXT NOT NULL,
    PRIMARY KEY (corrida_id, dimension, referencia_id)
);
COMMENT ON TABLE analisis_corrida_filtros IS 'Filtros aplicados al dataset. Sin filas = la corrida abarcó todo el universo del periodo.';

-- =====================================================================
-- 5. SEGMENTOS DE INGRESO Y ZONAS
--    RN-01, RN-02. El ingreso se asigna por ZONA agregada; nunca se
--    infiere el ingreso de una persona a partir de su compra.
-- =====================================================================

-- Columnas codigo/fuente/frecuencia_actualizacion/relacion_zona/limitaciones
-- agregadas en Sprint 1 (M05): el profesor exigió que cada segmento
-- justifique explícitamente su fuente, periodicidad, relación con zona y
-- limitaciones (RN-01, RN-02), no solo el rango numérico.
CREATE TABLE segmentos_ingreso (
    id                          SMALLSERIAL PRIMARY KEY,
    codigo                      VARCHAR(20) NOT NULL UNIQUE,
    nombre                      VARCHAR(60) NOT NULL UNIQUE,
    ingreso_min                 NUMERIC(12,2) NOT NULL,
    ingreso_max                 NUMERIC(12,2),
    fuente                      TEXT NOT NULL,
    frecuencia_actualizacion    VARCHAR(60) NOT NULL,
    relacion_zona               TEXT NOT NULL,
    limitaciones                TEXT NOT NULL,
    descripcion                 TEXT,
    CONSTRAINT chk_segmento_rango CHECK (ingreso_max IS NULL OR ingreso_max > ingreso_min)
);
COMMENT ON TABLE segmentos_ingreso IS 'Rangos de clasificación por nivel de ingreso (RN-01), con la justificación de fuente/actualización/relación con zona/limitaciones que exige la retroalimentación del profesor.';

-- FNBC (v4). El clustering de M05 no asigna segmentos zona por zona:
-- asigna un segmento a cada CLUSTER, y la zona hereda el del cluster que
-- le tocó. Guardar el segmento en `zona_clasificaciones` junto al
-- cluster creaba la dependencia funcional
--     (corrida_id, cluster_valor) -> segmento_ingreso_id
-- con un determinante que no es llave de esa tabla: las 40 zonas del
-- cluster 3 repetían el mismo segmento y nada impedía que la zona 17
-- dijera otro. El mapeo vive aquí, una sola vez por cluster.
CREATE TABLE corrida_clusters (
    corrida_id          UUID NOT NULL REFERENCES analisis_corridas(id) ON DELETE CASCADE,
    cluster_valor       INTEGER NOT NULL,
    segmento_ingreso_id SMALLINT NOT NULL REFERENCES segmentos_ingreso(id),
    etiqueta            VARCHAR(60),
    PRIMARY KEY (corrida_id, cluster_valor)
);
COMMENT ON TABLE corrida_clusters IS 'Mapeo cluster -> segmento de ingreso de una corrida de clasificación (M05). Un cluster, un segmento.';

-- La zona conserva SOLO lo que la identifica. Su clasificación y sus
-- indicadores cambian con el tiempo y viven en tablas aparte.
CREATE TABLE zonas (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                  VARCHAR(120) NOT NULL,
    municipio_id            SMALLINT NOT NULL REFERENCES municipios(id),
    descripcion             TEXT,
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nombre, municipio_id)
);
COMMENT ON TABLE zonas IS 'Zona geográfica. Identidad únicamente: clasificación en zona_clasificaciones, medidas en zona_indicadores.';

CREATE TRIGGER trg_zonas_updated_at
    BEFORE UPDATE ON zonas
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_zonas_municipio ON zonas(municipio_id);

-- Historial de clasificación. Reclasificar una zona no borra cómo
-- estaba clasificada cuando se calculó un indicador el mes pasado.
--
-- Dos caminos excluyentes para llegar al segmento:
--   A) asignación manual  -> el segmento se escribe en segmento_manual_id
--   B) resultado de una corrida de clustering -> el segmento lo dicta el
--      cluster, y se lee de `corrida_clusters` (no se copia aquí, que es
--      justo lo que rompía FNBC en v3).
CREATE TABLE zona_clasificaciones (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zona_id                 UUID NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
    segmento_manual_id      SMALLINT REFERENCES segmentos_ingreso(id),
    corrida_id              UUID,
    cluster_valor           INTEGER,
    vigente_desde           DATE NOT NULL DEFAULT CURRENT_DATE,
    -- Cerrar una clasificación es ponerle fecha de fin, no mover una
    -- bandera aparte que pudiera contradecirla (3FN).
    vigente_hasta           DATE,
    vigente                 BOOLEAN GENERATED ALWAYS AS (vigente_hasta IS NULL) STORED,
    asignada_por            UUID REFERENCES usuarios(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_zclas_cluster FOREIGN KEY (corrida_id, cluster_valor)
        REFERENCES corrida_clusters(corrida_id, cluster_valor),
    CONSTRAINT chk_zclas_origen CHECK (
        (segmento_manual_id IS NOT NULL AND corrida_id IS NULL     AND cluster_valor IS NULL)
     OR (segmento_manual_id IS NULL     AND corrida_id IS NOT NULL AND cluster_valor IS NOT NULL)
    ),
    CONSTRAINT chk_zclas_vigencia CHECK (
        vigente_hasta IS NULL OR vigente_hasta >= vigente_desde
    )
);
COMMENT ON TABLE zona_clasificaciones IS 'Clasificación de una zona en un segmento de ingreso, con su trazabilidad (RN-02). Manual o por cluster, nunca las dos.';

-- Una sola clasificación vigente por zona.
CREATE UNIQUE INDEX uq_zona_clasificacion_vigente
    ON zona_clasificaciones(zona_id) WHERE vigente;
CREATE INDEX idx_zona_clasif_segmento ON zona_clasificaciones(segmento_manual_id);
CREATE INDEX idx_zona_clasif_cluster ON zona_clasificaciones(corrida_id, cluster_valor);

-- Resuelve el segmento venga de donde venga. Todo el resto del esquema
-- (canastas, tablero) consulta ESTA vista, no la tabla.
CREATE VIEW v_zona_segmento AS
SELECT zc.id AS clasificacion_id,
       zc.zona_id,
       COALESCE(zc.segmento_manual_id, cc.segmento_ingreso_id) AS segmento_ingreso_id,
       zc.corrida_id, zc.cluster_valor,
       zc.vigente, zc.vigente_desde, zc.vigente_hasta
FROM zona_clasificaciones zc
LEFT JOIN corrida_clusters cc
       ON cc.corrida_id = zc.corrida_id AND cc.cluster_valor = zc.cluster_valor;
COMMENT ON VIEW v_zona_segmento IS 'Segmento de ingreso vigente de cada zona, resolviendo la asignación manual o la del cluster.';

-- =====================================================================
-- 6. INDICADORES
--    Catálogo + serie de valores. Agregar "gasto por categoría" o
--    "unidades por transacción" es insertar una fila, no un ALTER TABLE.
-- =====================================================================

CREATE TYPE ambito_indicador AS ENUM ('global','tienda','zona','segmento','categoria','producto');

CREATE TABLE indicadores (
    id              SMALLSERIAL PRIMARY KEY,
    clave           VARCHAR(60) NOT NULL UNIQUE,  -- 'ticket_promedio'
    nombre          VARCHAR(120) NOT NULL,
    descripcion     TEXT NOT NULL,
    unidad          VARCHAR(30) NOT NULL,          -- 'MXN', 'unidades', 'compras/mes', '%'
    ambito          ambito_indicador NOT NULL,
    -- Cómo se calcula, en texto: el profesor pidió que un indicador sea
    -- interpretable, no un número suelto.
    formula         TEXT
);
COMMENT ON TABLE indicadores IS 'Catálogo de indicadores calculables: ticket promedio, productos por canasta, frecuencia de compra, unidades por transacción, gasto por categoría, población, ingreso estimado, disponibilidad…';

-- `indicador_valores` (la tabla de hechos) se declara más abajo, después
-- de `productos`: sus dimensiones apuntan a tiendas, categorías y
-- productos, que se crean en las secciones 7 y 8. Declararla aquí
-- obligaba a parchearla después con ALTER TABLE.

-- =====================================================================
-- 7. TIENDAS
-- =====================================================================

CREATE TYPE formato_tienda AS ENUM ('supermercado','minimarket','tienda_conveniencia','mayorista','otro');

CREATE TABLE tiendas (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre              VARCHAR(150) NOT NULL,
    direccion_id        UUID NOT NULL REFERENCES direcciones(id),
    zona_id             UUID NOT NULL REFERENCES zonas(id),
    proveedor_id        UUID REFERENCES proveedores(id),
    formato             formato_tienda NOT NULL DEFAULT 'otro',
    numero_sucursal     VARCHAR(20),
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE tiendas IS 'Tiendas/sucursales. La dirección vive en direcciones y el canal web en tienda_canal_web.';

CREATE TRIGGER trg_tiendas_updated_at
    BEFORE UPDATE ON tiendas
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tiendas_zona ON tiendas(zona_id);
CREATE INDEX idx_tiendas_activo ON tiendas(activo);
CREATE INDEX idx_tiendas_proveedor ON tiendas(proveedor_id) WHERE proveedor_id IS NOT NULL;

-- Antes eran dos columnas en `tiendas`, y la segunda solo tenía sentido
-- si la primera era TRUE. La existencia de la fila ES el "tiene web".
CREATE TABLE tienda_canal_web (
    tienda_id           UUID PRIMARY KEY REFERENCES tiendas(id) ON DELETE CASCADE,
    url                 TEXT,
    gestion_datos       TEXT NOT NULL,   -- cómo administra sus datos (RN-01)
    integrada           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE tienda_canal_web IS 'Datos del sitio propio de una tienda. Si no hay fila, la tienda no tiene web (RN-01).';

-- =====================================================================
-- 8. CATÁLOGO: CATEGORÍAS, PRODUCTOS Y PRESENTACIONES
--    RF-35: la presentación es una tabla relacionada, no un campo plano.
-- =====================================================================

CREATE TABLE categorias_producto (
    id                  SMALLSERIAL PRIMARY KEY,
    nombre              VARCHAR(80) NOT NULL UNIQUE,
    categoria_padre_id  SMALLINT REFERENCES categorias_producto(id),
    descripcion         TEXT
);
COMMENT ON TABLE categorias_producto IS 'Categorías y subcategorías; soporta criterios de sustituibilidad (RN-11).';

CREATE TYPE tipo_unidad AS ENUM ('masa','volumen','pieza','longitud');

CREATE TABLE unidades_medida (
    id              SMALLSERIAL PRIMARY KEY,
    clave           VARCHAR(10) NOT NULL UNIQUE,   -- 'kg','g','l','ml','pza'
    nombre          VARCHAR(40) NOT NULL,
    tipo            tipo_unidad NOT NULL,
    -- Factor a la unidad base de su tipo (kg, l, pieza). Permite
    -- comparar precio por kilo entre presentaciones distintas, que es lo
    -- que necesita el análisis de accesibilidad.
    factor_base     NUMERIC(12,6) NOT NULL CHECK (factor_base > 0)
);
COMMENT ON TABLE unidades_medida IS 'Catálogo de unidades. Antes era el texto libre productos.unidad_medida.';

CREATE TYPE estatus_producto AS ENUM ('activo','pendiente_aprobacion','rechazado','inactivo');

CREATE TABLE productos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku                 VARCHAR(40) NOT NULL UNIQUE,
    nombre              VARCHAR(150) NOT NULL,
    descripcion         TEXT,
    categoria_id        SMALLINT NOT NULL REFERENCES categorias_producto(id),
    es_canasta_basica   BOOLEAN NOT NULL DEFAULT FALSE,  -- RN-04
    proveedor_id        UUID REFERENCES proveedores(id), -- NULL = alta interna
    -- Estado ACTUAL. Depende solo de la llave, así que se queda aquí;
    -- el detalle de cada decisión (quién, cuándo, por qué) está en
    -- producto_revisiones.
    estatus             estatus_producto NOT NULL DEFAULT 'pendiente_aprobacion',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE productos IS 'Catálogo de productos. Sin unidad de medida (vive en presentaciones) y sin datos de la revisión (viven en producto_revisiones).';

CREATE TRIGGER trg_productos_updated_at
    BEFORE UPDATE ON productos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_productos_categoria ON productos(categoria_id);
CREATE INDEX idx_productos_proveedor ON productos(proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX idx_productos_estatus ON productos(estatus);
CREATE INDEX idx_productos_basicos ON productos(es_canasta_basica) WHERE es_canasta_basica;

-- --- Tabla de hechos de indicadores ----------------------------------
-- Se declara aquí, y no junto al catálogo `indicadores`, porque sus
-- dimensiones apuntan a zonas, segmentos, tiendas, categorías y
-- productos: hasta este punto ya existen todas y la tabla se crea
-- completa, sin ALTER posteriores.
CREATE TABLE indicador_valores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    indicador_id        SMALLINT NOT NULL REFERENCES indicadores(id),
    corrida_id          UUID NOT NULL REFERENCES analisis_corridas(id) ON DELETE CASCADE,
    -- Dimensiones. Se llenan solo las que apliquen al ámbito del
    -- indicador; un ticket promedio puede ser por tienda, por zona, por
    -- segmento o por combinación de ellas.
    tienda_id           UUID     REFERENCES tiendas(id),
    zona_id             UUID     REFERENCES zonas(id),
    segmento_ingreso_id SMALLINT REFERENCES segmentos_ingreso(id),
    categoria_id        SMALLINT REFERENCES categorias_producto(id),
    producto_id         UUID     REFERENCES productos(id),
    periodo_inicio      DATE NOT NULL,
    periodo_fin         DATE NOT NULL,
    valor               NUMERIC(16,4) NOT NULL,
    muestra             INTEGER,   -- nº de observaciones que respaldan el valor
    CONSTRAINT chk_indicador_periodo CHECK (periodo_fin >= periodo_inicio),
    -- 3FN. Una tienda ya determina su zona, y un producto su categoría:
    -- llenar ambas columnas de un par creaba una dependencia transitiva
    -- y permitía una fila que dijera "tienda del Valle, zona Oriente".
    -- Se elige el grano, no los dos.
    CONSTRAINT chk_indvalor_grano_territorial CHECK (
        NOT (tienda_id IS NOT NULL AND zona_id IS NOT NULL)
    ),
    CONSTRAINT chk_indvalor_grano_producto CHECK (
        NOT (producto_id IS NOT NULL AND categoria_id IS NOT NULL)
    ),
    -- La tabla NO tenía llave más allá del UUID sustituto: el mismo
    -- indicador, misma corrida, mismas dimensiones y mismo periodo podía
    -- insertarse cuantas veces se reintentara el cálculo. Sin llave real
    -- no se puede afirmar ninguna forma normal sobre la tabla.
    -- NULLS NOT DISTINCT (PG 15+) es indispensable aquí: las dimensiones
    -- no aplicables son NULL, y con la semántica por omisión dos filas
    -- idénticas con NULL se consideran distintas y la UNIQUE no serviría.
    CONSTRAINT uq_indicador_valor UNIQUE NULLS NOT DISTINCT (
        indicador_id, corrida_id, tienda_id, zona_id, segmento_ingreso_id,
        categoria_id, producto_id, periodo_inicio, periodo_fin
    )
);
COMMENT ON TABLE indicador_valores IS 'Valor de un indicador para una combinación de dimensiones y un periodo. Tabla de hechos: las dimensiones no aplicables quedan en NULL, y las que se implican entre sí no se llenan juntas.';

CREATE INDEX idx_indvalor_indicador ON indicador_valores(indicador_id, periodo_inicio, periodo_fin);
CREATE INDEX idx_indvalor_zona ON indicador_valores(zona_id) WHERE zona_id IS NOT NULL;
CREATE INDEX idx_indvalor_tienda ON indicador_valores(tienda_id) WHERE tienda_id IS NOT NULL;
CREATE INDEX idx_indvalor_corrida ON indicador_valores(corrida_id);

-- Ingreso estimado, población y disponibilidad de la zona son medidas
-- que cambian con el tiempo: son indicadores, no columnas de `zonas`.
CREATE VIEW v_zona_indicadores AS
SELECT z.id AS zona_id, z.nombre AS zona, i.clave, i.nombre AS indicador,
       iv.valor, i.unidad, iv.periodo_inicio, iv.periodo_fin
FROM indicador_valores iv
JOIN indicadores i ON i.id = iv.indicador_id
JOIN zonas z ON z.id = iv.zona_id;
COMMENT ON VIEW v_zona_indicadores IS 'Atajo de lectura para los indicadores de una zona (ingreso estimado, población, disponibilidad…).';

-- RF-35. Un producto tiene varias presentaciones (500 g, 1 kg, 6 pzas).
-- Precios, inventario y líneas de venta apuntan AQUÍ, no a productos.
CREATE TABLE producto_presentaciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id         UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    nombre              VARCHAR(60) NOT NULL,          -- '500 g', 'Six-pack'
    contenido           NUMERIC(12,3) NOT NULL CHECK (contenido > 0),
    unidad_medida_id    SMALLINT NOT NULL REFERENCES unidades_medida(id),
    codigo_barras       VARCHAR(20) UNIQUE,
    es_predeterminada   BOOLEAN NOT NULL DEFAULT FALSE,
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (producto_id, nombre)
);
COMMENT ON TABLE producto_presentaciones IS 'Presentaciones de un producto (RF-35). El precio y la venta se registran contra la presentación.';

CREATE TRIGGER trg_presentaciones_updated_at
    BEFORE UPDATE ON producto_presentaciones
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Una sola presentación predeterminada por producto.
CREATE UNIQUE INDEX uq_presentacion_predeterminada
    ON producto_presentaciones(producto_id) WHERE es_predeterminada;
CREATE INDEX idx_presentaciones_producto ON producto_presentaciones(producto_id);

-- Un producto puede tener varias imágenes: era un atributo multivaluado
-- comprimido en productos.imagen_url.
CREATE TABLE producto_imagenes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id         UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    url                 TEXT NOT NULL,
    orden               SMALLINT NOT NULL DEFAULT 1,
    es_principal        BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (producto_id, orden)
);
COMMENT ON TABLE producto_imagenes IS 'Imágenes del producto. Antes era la única columna imagen_url.';

CREATE UNIQUE INDEX uq_producto_imagen_principal
    ON producto_imagenes(producto_id) WHERE es_principal;

-- Cada decisión sobre una propuesta es un EVENTO con su propio autor,
-- fecha y motivo. Antes vivía como columnas nulables en `productos`,
-- y sobrescribía el historial en cada revisión.
CREATE TABLE producto_revisiones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id         UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    estatus_resultante  estatus_producto NOT NULL,
    revisado_por        UUID NOT NULL REFERENCES usuarios(id),
    motivo              TEXT,
    revisado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_revision_rechazo CHECK (
        (estatus_resultante = 'rechazado' AND motivo IS NOT NULL)
        OR estatus_resultante <> 'rechazado'
    )
);
COMMENT ON TABLE producto_revisiones IS 'Historial de aprobaciones y rechazos de una propuesta de alta (RF-12).';

CREATE INDEX idx_revisiones_producto ON producto_revisiones(producto_id, revisado_en DESC);

-- =====================================================================
-- 9. INVENTARIO Y PRECIOS
--    Ambos cuelgan de la PRESENTACIÓN: 500 g y 1 kg del mismo producto
--    tienen precio y stock distintos.
-- =====================================================================

CREATE TABLE inventario (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tienda_id           UUID NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
    presentacion_id     UUID NOT NULL REFERENCES producto_presentaciones(id) ON DELETE CASCADE,
    stock_disponible    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock_disponible >= 0),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tienda_id, presentacion_id)
);
COMMENT ON TABLE inventario IS 'Stock por tienda y presentación. Insumo de la disponibilidad que usa M12 Accesibilidad (RN-04).';

CREATE INDEX idx_inventario_presentacion ON inventario(presentacion_id);

CREATE TYPE origen_precio AS ENUM ('interno','propuesta_proveedor_aprobada');

CREATE TABLE precios (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    presentacion_id         UUID NOT NULL REFERENCES producto_presentaciones(id) ON DELETE CASCADE,
    tienda_id               UUID NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
    precio                  NUMERIC(12,2) NOT NULL CHECK (precio > 0),
    fecha_vigencia_desde    DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_vigencia_hasta    DATE,
    -- 3FN. `vigente` estaba determinada por `fecha_vigencia_hasta` y las
    -- dos se guardaban por separado: se podía dejar un precio marcado
    -- como vigente con fecha de fin, o al revés. Cerrar un precio ahora
    -- es ponerle fecha de fin, y la bandera se sigue sola.
    vigente                 BOOLEAN GENERATED ALWAYS AS (fecha_vigencia_hasta IS NULL) STORED,
    origen                  origen_precio NOT NULL DEFAULT 'interno',
    creado_por              UUID REFERENCES usuarios(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_precio_vigencia CHECK (
        fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde
    ),
    -- uq_precios_vigente (abajo) solo cubre el precio ACTUAL. Sin esto,
    -- el histórico admitía dos precios distintos para la misma
    -- presentación/tienda arrancando el mismo día: la llave natural
    -- existía en la intención del equipo (data_retail.sql la protege con
    -- un NOT EXISTS sobre justo estas tres columnas) pero no en la base.
    UNIQUE (presentacion_id, tienda_id, fecha_vigencia_desde)
);
COMMENT ON TABLE precios IS 'Historial versionado de precios por presentación/tienda (RN-06). El histórico NO se sobrescribe: es lo que hace posible calcular elasticidad y variación de precios.';

CREATE UNIQUE INDEX uq_precios_vigente
    ON precios(presentacion_id, tienda_id) WHERE vigente;
CREATE INDEX idx_precios_presentacion ON precios(presentacion_id);
CREATE INDEX idx_precios_tienda ON precios(tienda_id);
CREATE INDEX idx_precios_vigencia ON precios(fecha_vigencia_desde, fecha_vigencia_hasta);

CREATE TYPE estatus_propuesta AS ENUM ('pendiente','aprobado','rechazado');

CREATE TABLE precios_propuestos_proveedor (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    presentacion_id     UUID NOT NULL REFERENCES producto_presentaciones(id) ON DELETE CASCADE,
    proveedor_id        UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
    precio_propuesto    NUMERIC(12,2) NOT NULL CHECK (precio_propuesto > 0),
    unidad_compra       VARCHAR(30),
    estatus             estatus_propuesta NOT NULL DEFAULT 'pendiente',
    motivo_rechazo      TEXT,
    revisado_por        UUID REFERENCES usuarios(id),
    revisado_en         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_precio_propuesto_rechazo CHECK (
        (estatus = 'rechazado' AND motivo_rechazo IS NOT NULL) OR estatus <> 'rechazado'
    )
);
COMMENT ON TABLE precios_propuestos_proveedor IS 'Precios propuestos por proveedores (RN-14).';

CREATE INDEX idx_precios_prop_presentacion ON precios_propuestos_proveedor(presentacion_id);
CREATE INDEX idx_precios_prop_estatus ON precios_propuestos_proveedor(estatus);

CREATE TABLE limites_precio_zona (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zona_id             UUID NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
    presentacion_id     UUID REFERENCES producto_presentaciones(id) ON DELETE CASCADE, -- NULL = toda la zona
    variacion_max_pct   NUMERIC(5,2) NOT NULL CHECK (variacion_max_pct >= 0),
    precio_min          NUMERIC(12,2),
    precio_max          NUMERIC(12,2),
    actualizado_por     UUID REFERENCES usuarios(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_limite_precio_rango CHECK (
        precio_min IS NULL OR precio_max IS NULL OR precio_max >= precio_min
    ),
    -- presentacion_id NULL = el límite aplica a toda la zona. Con la
    -- semántica por omisión ese NULL hace que la UNIQUE no impida
    -- duplicados justo en el caso general.
    UNIQUE NULLS NOT DISTINCT (zona_id, presentacion_id)
);
COMMENT ON TABLE limites_precio_zona IS 'Variación máxima de precio permitida por zona (RN-06, RN-10).';

CREATE TABLE reglas_exclusion_asociacion (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_a_id      SMALLINT NOT NULL REFERENCES categorias_producto(id),
    categoria_b_id      SMALLINT NOT NULL REFERENCES categorias_producto(id),
    descripcion         TEXT,
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    creado_por          UUID REFERENCES usuarios(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- El hecho "A y B no se asocian" es simétrico. Con solo <> se podian
    -- guardar (A,B) y (B,A) como dos filas del mismo hecho. Ordenar el
    -- par lo vuelve una sola representación posible.
    CONSTRAINT chk_exclusion_par_canonico CHECK (categoria_a_id < categoria_b_id),
    UNIQUE (categoria_a_id, categoria_b_id)
);
COMMENT ON TABLE reglas_exclusion_asociacion IS 'Excluye asociaciones espurias entre categorías (RN-10).';

-- =====================================================================
-- 10. CLIENTES (RN-15)
-- =====================================================================

CREATE TYPE perfil_hogar AS ENUM ('vive_solo','depende_2_3_personas','depende_4_o_mas_personas');
CREATE TYPE frecuencia_compra AS ENUM ('diaria','cada_3_dias','semanal','quincenal','mensual');

CREATE TABLE clientes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                  VARCHAR(120),
    email                   VARCHAR(150) UNIQUE,
    telefono                VARCHAR(30),
    zona_id                 UUID REFERENCES zonas(id),
    perfil_hogar            perfil_hogar,
    frecuencia_esperada     frecuencia_compra,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE clientes IS 'Usuario final de la app móvil. NO guarda segmento propio: el segmento se deriva de su zona (RN-02), nunca de su compra individual.';

CREATE TRIGGER trg_clientes_updated_at
    BEFORE UPDATE ON clientes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_clientes_zona ON clientes(zona_id);

-- =====================================================================
-- 11. IMPORTACIÓN DE TRANSACCIONES POR CSV
--     Flujo obligatorio: recibir archivo -> validar formato -> detectar
--     errores -> preview -> confirmar -> insertar -> resumen -> auditar.
--     Las filas se quedan en staging hasta que alguien confirma: así el
--     preview es real y ninguna fila inválida llega a `transacciones`.
-- =====================================================================

CREATE TYPE estado_importacion AS ENUM (
    'cargado',      -- archivo recibido, sin validar
    'validado',     -- validado y sin errores: listo para confirmar
    'con_errores',  -- validado, hay filas rechazadas
    'confirmado',   -- las filas válidas ya se insertaron
    'descartado'    -- el usuario canceló
);

CREATE TABLE importaciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_archivo      VARCHAR(255) NOT NULL,
    -- SHA-256 del contenido: detecta que se suba dos veces el mismo archivo.
    hash_archivo        CHAR(64) NOT NULL,
    tamano_bytes        BIGINT NOT NULL CHECK (tamano_bytes > 0),
    tienda_id           UUID REFERENCES tiendas(id),  -- NULL = la tienda viene en cada fila
    estado              estado_importacion NOT NULL DEFAULT 'cargado',
    cargado_por         UUID NOT NULL REFERENCES usuarios(id),
    cargado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmado_por      UUID REFERENCES usuarios(id),
    confirmado_en       TIMESTAMPTZ,
    -- Resumen que se le muestra al usuario al terminar.
    filas_totales       INTEGER NOT NULL DEFAULT 0,
    filas_validas       INTEGER NOT NULL DEFAULT 0,
    filas_con_error     INTEGER NOT NULL DEFAULT 0,
    transacciones_creadas INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT chk_importacion_confirmacion CHECK (
        (estado = 'confirmado' AND confirmado_por IS NOT NULL AND confirmado_en IS NOT NULL)
        OR estado <> 'confirmado'
    ),
    CONSTRAINT chk_importacion_cuadre CHECK (filas_validas + filas_con_error <= filas_totales)
);
COMMENT ON TABLE importaciones IS 'Cabecera de una carga CSV: archivo, quién, cuándo, estado y resumen (RF-25 a RF-28).';

CREATE UNIQUE INDEX uq_importacion_hash_no_descartada
    ON importaciones(hash_archivo) WHERE estado <> 'descartado';
CREATE INDEX idx_importaciones_estado ON importaciones(estado, cargado_en DESC);

-- Staging tipado (no un blob de texto): permite mostrar el preview con
-- los valores ya interpretados y señalar exactamente qué celda falla.
CREATE TABLE importacion_filas (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    importacion_id      UUID NOT NULL REFERENCES importaciones(id) ON DELETE CASCADE,
    numero_fila         INTEGER NOT NULL CHECK (numero_fila > 0),
    -- Valores tal como venían en el archivo, sin convertir.
    folio_origen        VARCHAR(60),
    fecha_origen        VARCHAR(40),
    tienda_origen       VARCHAR(150),
    sku_origen          VARCHAR(60),
    presentacion_origen VARCHAR(60),
    cantidad_origen     VARCHAR(40),
    precio_origen       VARCHAR(40),
    -- Resultado de la validación: qué entidad resolvió cada texto.
    tienda_id           UUID REFERENCES tiendas(id),
    presentacion_id     UUID REFERENCES producto_presentaciones(id),
    fecha               TIMESTAMPTZ,
    cantidad            NUMERIC(10,2),
    precio_unitario     NUMERIC(12,2),
    valida              BOOLEAN NOT NULL DEFAULT FALSE,
    -- Se llena al confirmar: liga la fila con lo que produjo.
    transaccion_id      UUID,
    UNIQUE (importacion_id, numero_fila)
);
COMMENT ON TABLE importacion_filas IS 'Filas del CSV en staging. Nada pasa a transacciones hasta que la importación se confirma.';

CREATE INDEX idx_impfilas_importacion ON importacion_filas(importacion_id, valida);

CREATE TYPE severidad_error AS ENUM ('error','advertencia');

CREATE TABLE importacion_errores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    importacion_id      UUID NOT NULL REFERENCES importaciones(id) ON DELETE CASCADE,
    numero_fila         INTEGER,          -- NULL = error de formato del archivo completo
    columna             VARCHAR(60),
    codigo              VARCHAR(40) NOT NULL,   -- 'SKU_NO_EXISTE', 'FECHA_INVALIDA'
    mensaje             TEXT NOT NULL,
    severidad           severidad_error NOT NULL DEFAULT 'error',
    valor_recibido      TEXT
);
COMMENT ON TABLE importacion_errores IS 'Errores detectados en la validación, con fila y columna exactas para que el usuario corrija el archivo.';

CREATE INDEX idx_imperrores_importacion ON importacion_errores(importacion_id, severidad);

-- =====================================================================
-- 12. TRANSACCIONES
--     Estructura exigida:
--       TRANSACCION(id, tienda, fecha, total)
--         └── detalles[](producto, presentación, cantidad,
--                        precio_unitario, subtotal)
--
--     El detalle guarda `presentacion_id` y NO `producto_id`: el
--     producto se obtiene por join desde la presentación. Guardar los
--     dos sería una dependencia transitiva (producto depende de la
--     presentación, no de la línea) y permitiría que se contradijeran.
--     La vista v_transaccion_detalle de abajo entrega ambos.
-- =====================================================================

CREATE TYPE canal_transaccion AS ENUM ('punto_venta','app_movil','web','importacion_csv','otro');

CREATE TABLE transacciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folio               VARCHAR(40) NOT NULL,
    tienda_id           UUID NOT NULL REFERENCES tiendas(id),
    cliente_id          UUID REFERENCES clientes(id),
    canal               canal_transaccion NOT NULL DEFAULT 'punto_venta',
    fecha               TIMESTAMPTZ NOT NULL DEFAULT now(),
    total               NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    -- Trazabilidad de origen: de qué carga CSV salió, si vino de una.
    importacion_id      UUID REFERENCES importaciones(id),
    capturada_por       UUID REFERENCES usuarios(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tienda_id, folio)
);
COMMENT ON TABLE transacciones IS 'Encabezado de venta. Una transacción = una canasta (RN-03).';

CREATE INDEX idx_transacciones_tienda_fecha ON transacciones(tienda_id, fecha);
CREATE INDEX idx_transacciones_fecha ON transacciones(fecha);
CREATE INDEX idx_transacciones_importacion ON transacciones(importacion_id) WHERE importacion_id IS NOT NULL;

-- ÚNICO ALTER del archivo, y no se puede evitar reordenando: la
-- dependencia entre importaciones y transacciones es CIRCULAR.
--     transacciones.importacion_id  -> importaciones(id)
--     importacion_filas.transaccion_id -> transacciones(id)
-- Cuál se declare primero, a la otra le falta la contraparte. La única
-- alternativa sería declarar la llave foránea como DEFERRABLE, que
-- resuelve el orden de INSERT pero no el de CREATE TABLE. Se cierra
-- aquí, en cuanto ambas tablas existen.
ALTER TABLE importacion_filas
    ADD CONSTRAINT fk_impfila_transaccion FOREIGN KEY (transaccion_id) REFERENCES transacciones(id);

CREATE TABLE transacciones_detalle (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaccion_id      UUID NOT NULL REFERENCES transacciones(id) ON DELETE CASCADE,
    presentacion_id     UUID NOT NULL REFERENCES producto_presentaciones(id),
    cantidad            NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
    -- Precio al que se vendió: se congela aquí porque `precios` cambia y
    -- el histórico de ventas no se puede reescribir.
    precio_unitario     NUMERIC(12,2) NOT NULL CHECK (precio_unitario > 0),
    subtotal            NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
    UNIQUE (transaccion_id, presentacion_id)
);
COMMENT ON TABLE transacciones_detalle IS 'Líneas de la transacción. subtotal es columna generada: no se puede desincronizar de cantidad x precio.';

CREATE INDEX idx_detalle_transaccion ON transacciones_detalle(transaccion_id);
CREATE INDEX idx_detalle_presentacion ON transacciones_detalle(presentacion_id);

CREATE VIEW v_transaccion_detalle AS
SELECT d.id, d.transaccion_id, t.folio, t.fecha, t.tienda_id,
       p.id AS producto_id, p.sku, p.nombre AS producto, p.es_canasta_basica,
       pp.id AS presentacion_id, pp.nombre AS presentacion,
       pp.contenido, um.clave AS unidad,
       c.id AS categoria_id, c.nombre AS categoria,
       d.cantidad, d.precio_unitario, d.subtotal
FROM transacciones_detalle d
JOIN transacciones t ON t.id = d.transaccion_id
JOIN producto_presentaciones pp ON pp.id = d.presentacion_id
JOIN productos p ON p.id = pp.producto_id
JOIN unidades_medida um ON um.id = pp.unidad_medida_id
JOIN categorias_producto c ON c.id = p.categoria_id;
COMMENT ON VIEW v_transaccion_detalle IS 'Línea de venta con producto Y presentación resueltos, como los pide la API.';

-- =====================================================================
-- 13. CANASTAS
--     Consultables por: canasta, tienda, zona, segmento, fecha, valor
--     total, número de productos, productos básicos y tamaño de compra.
--
--     Es una materialización deliberada, no una duplicación por
--     descuido: la zona y el segmento se congelan al construirla, porque
--     una zona se puede reclasificar después y eso NO debe reescribir el
--     análisis de meses pasados. Los conteos se guardan porque el
--     dashboard tiene que responder sobre millones de líneas.
-- =====================================================================

CREATE TYPE tamano_compra AS ENUM ('chica','mediana','grande');

-- 3FN. En v3 `canastas.tamano` era una columna determinada por
-- `valor_total` (no llave -> no llave): el criterio de RN-05 vivía
-- escondido en un CASE del código de carga y se congelaba fila por fila.
-- Aquí el umbral es un dato: cambiarlo es un UPDATE de tres filas, no un
-- ALTER TABLE ni un reproceso. Rangos semiabiertos [min, max).
CREATE TABLE tamanos_compra (
    codigo      tamano_compra PRIMARY KEY,
    valor_min   NUMERIC(14,2) NOT NULL CHECK (valor_min >= 0),
    valor_max   NUMERIC(14,2),   -- NULL = sin tope superior
    descripcion TEXT,
    CONSTRAINT chk_tamano_rango CHECK (valor_max IS NULL OR valor_max > valor_min),
    -- Los rangos NO se pueden traslapar: si lo hicieran, el join de
    -- v_canastas devolvería la misma canasta dos veces. El CHECK de
    -- arriba solo valida cada fila por separado; esto valida el conjunto.
    -- numrange(min, NULL) queda abierto por arriba, que es justo 'grande'.
    CONSTRAINT excl_tamano_sin_traslape EXCLUDE USING gist (
        numrange(valor_min, valor_max, '[)') WITH &&
    )
);
COMMENT ON TABLE tamanos_compra IS 'Umbrales de RN-05 que clasifican una canasta por su valor total. El tamaño se resuelve en v_canastas, no se guarda.';

CREATE TABLE canastas (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaccion_id              UUID NOT NULL UNIQUE REFERENCES transacciones(id) ON DELETE CASCADE,
    corrida_id                  UUID REFERENCES analisis_corridas(id),
    -- Clasificación vigente AL MOMENTO de construir la canasta.
    zona_id                     UUID NOT NULL REFERENCES zonas(id),
    segmento_ingreso_id         SMALLINT REFERENCES segmentos_ingreso(id),
    fecha                       TIMESTAMPTZ NOT NULL,
    valor_total                 NUMERIC(14,2) NOT NULL CHECK (valor_total >= 0),
    numero_productos            INTEGER NOT NULL CHECK (numero_productos >= 0),
    unidades_totales            NUMERIC(12,2) NOT NULL CHECK (unidades_totales >= 0),
    productos_basicos           INTEGER NOT NULL DEFAULT 0 CHECK (productos_basicos >= 0),
    -- `tamano` ya no se guarda: se deriva de valor_total contra el
    -- catálogo `tamanos_compra` (ver v_canastas).
    construida_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_canasta_basicos CHECK (productos_basicos <= numero_productos)
);
COMMENT ON TABLE canastas IS 'Canasta de consumo derivada de una transacción (RN-03, RN-05). Una transacción produce exactamente una canasta.';

CREATE INDEX idx_canastas_zona_fecha ON canastas(zona_id, fecha);
CREATE INDEX idx_canastas_segmento ON canastas(segmento_ingreso_id);
CREATE INDEX idx_canastas_fecha ON canastas(fecha);
-- Sustituye a idx_canastas_tamano: filtrar por tamaño es filtrar por
-- rango de valor_total.
CREATE INDEX idx_canastas_valor_total ON canastas(valor_total);

CREATE VIEW v_canastas AS
SELECT k.id AS canasta_id, k.fecha, k.valor_total, k.numero_productos,
       k.unidades_totales, k.productos_basicos,
       tc.codigo AS tamano,
       t.id AS transaccion_id, t.folio,
       ti.id AS tienda_id, ti.nombre AS tienda,
       z.id AS zona_id, z.nombre AS zona,
       m.nombre AS municipio,
       s.id AS segmento_id, s.nombre AS segmento
FROM canastas k
JOIN transacciones t ON t.id = k.transaccion_id
JOIN tiendas ti ON ti.id = t.tienda_id
JOIN zonas z ON z.id = k.zona_id
JOIN municipios m ON m.id = z.municipio_id
LEFT JOIN segmentos_ingreso s ON s.id = k.segmento_ingreso_id
LEFT JOIN tamanos_compra tc ON k.valor_total >= tc.valor_min
                           AND (tc.valor_max IS NULL OR k.valor_total < tc.valor_max);
COMMENT ON VIEW v_canastas IS 'Consulta de canastas con todas las dimensiones que pide el requerimiento.';

-- =====================================================================
-- 14. RESULTADOS ANALÍTICOS
-- =====================================================================

-- --- M10 Reglas de asociación (Apriori / FP-Growth) ------------------
-- El antecedente de una regla es un CONJUNTO de productos. Guardarlo
-- como texto ("leche, pan") rompe 1FN e impide consultar "qué reglas
-- involucran el producto X". Por eso va en su propia tabla.
CREATE TABLE reglas_asociacion (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corrida_id          UUID NOT NULL REFERENCES analisis_corridas(id) ON DELETE CASCADE,
    soporte             NUMERIC(6,5) NOT NULL CHECK (soporte BETWEEN 0 AND 1),
    confianza           NUMERIC(6,5) NOT NULL CHECK (confianza BETWEEN 0 AND 1),
    lift                NUMERIC(10,4),
    transacciones_regla INTEGER
);
COMMENT ON TABLE reglas_asociacion IS 'Regla de asociación producida por una corrida de M10 (RF-15).';

CREATE INDEX idx_reglas_corrida ON reglas_asociacion(corrida_id, confianza DESC);

CREATE TYPE lado_regla AS ENUM ('antecedente','consecuente');

CREATE TABLE regla_asociacion_items (
    regla_id            UUID NOT NULL REFERENCES reglas_asociacion(id) ON DELETE CASCADE,
    producto_id         UUID NOT NULL REFERENCES productos(id),
    lado                lado_regla NOT NULL,
    PRIMARY KEY (regla_id, producto_id, lado)
);
COMMENT ON TABLE regla_asociacion_items IS 'Ítems de cada lado de la regla. Permite buscar reglas por producto.';

CREATE INDEX idx_regla_items_producto ON regla_asociacion_items(producto_id);

-- --- M11 Sustitución -------------------------------------------------
CREATE TYPE tipo_sustitucion AS ENUM ('precio','desabasto','preferencia');

CREATE TABLE sustituciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corrida_id          UUID NOT NULL REFERENCES analisis_corridas(id) ON DELETE CASCADE,
    producto_origen_id  UUID NOT NULL REFERENCES productos(id),
    producto_destino_id UUID NOT NULL REFERENCES productos(id),
    zona_id             UUID REFERENCES zonas(id),
    tipo                tipo_sustitucion NOT NULL,
    score               NUMERIC(6,4) NOT NULL CHECK (score BETWEEN 0 AND 1),
    observaciones       INTEGER,
    CONSTRAINT chk_sustitucion_distintos CHECK (producto_origen_id <> producto_destino_id),
    -- zona_id NULL = agregado nacional; sin NULLS NOT DISTINCT la
    -- restricción no impedía duplicar justo ese caso.
    UNIQUE NULLS NOT DISTINCT (corrida_id, producto_origen_id, producto_destino_id, zona_id)
);
COMMENT ON TABLE sustituciones IS 'Patrón de sustitución detectado entre dos productos (RN-11).';

-- --- M11 Elasticidad -------------------------------------------------
CREATE TYPE clasificacion_elasticidad AS ENUM ('elastica','inelastica','unitaria');

CREATE TABLE elasticidades (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corrida_id          UUID NOT NULL REFERENCES analisis_corridas(id) ON DELETE CASCADE,
    presentacion_id     UUID NOT NULL REFERENCES producto_presentaciones(id),
    zona_id             UUID REFERENCES zonas(id),      -- NULL = agregado nacional
    valor               NUMERIC(10,4) NOT NULL,
    -- 3FN. `valor -> clasificacion` es una dependencia de un atributo no
    -- llave sobre otro atributo no llave: en v3 la clasificación se
    -- guardaba aparte y un CHECK vigilaba que no se contradijera. Como
    -- columna GENERADA deja de ser un dato que alguien pueda escribir
    -- mal: se sigue consultando igual, pero ya no es información
    -- independiente que pueda desincronizarse.
    clasificacion       clasificacion_elasticidad GENERATED ALWAYS AS (
        CASE
            WHEN abs(valor) > 1.05 THEN 'elastica'::clasificacion_elasticidad
            WHEN abs(valor) < 0.95 THEN 'inelastica'::clasificacion_elasticidad
            ELSE 'unitaria'::clasificacion_elasticidad
        END
    ) STORED,
    r_cuadrada          NUMERIC(6,5) CHECK (r_cuadrada IS NULL OR r_cuadrada BETWEEN 0 AND 1),
    observaciones       INTEGER NOT NULL CHECK (observaciones > 0),
    -- zona_id NULL = agregado nacional (ver nota de `sustituciones`).
    UNIQUE NULLS NOT DISTINCT (corrida_id, presentacion_id, zona_id)
);
COMMENT ON TABLE elasticidades IS 'Elasticidad precio-demanda. |E|>1 elástica, |E|<1 inelástica, |E|≈1 unitaria: la clasificación se deriva del valor, no se captura.';

CREATE INDEX idx_elasticidad_presentacion ON elasticidades(presentacion_id);

-- --- M12 Accesibilidad ----------------------------------------------
-- No es "precio bajo": es un índice compuesto. Los componentes se
-- guardan por separado para que el número sea explicable.
CREATE TABLE accesibilidad_zona (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corrida_id          UUID NOT NULL REFERENCES analisis_corridas(id) ON DELETE CASCADE,
    zona_id             UUID NOT NULL REFERENCES zonas(id),
    indice              NUMERIC(6,4) NOT NULL CHECK (indice BETWEEN 0 AND 1),
    UNIQUE (corrida_id, zona_id)
);
COMMENT ON TABLE accesibilidad_zona IS 'Índice de accesibilidad por zona. Indicador analítico, NO una medida absoluta de bienestar.';

CREATE TYPE componente_accesibilidad AS ENUM (
    'precio','ingreso_segmento','disponibilidad','cobertura_basicos'
);

-- 2FN. Ésta era la peor violación del esquema v3. `peso` vivía en
-- `accesibilidad_componentes`, cuya llave es (accesibilidad_id,
-- componente), pero el peso NO depende de la zona: es la ponderación del
-- MODELO. Dependía solo de `componente`, una PARTE de la llave — eso es
-- exactamente una dependencia parcial, y bajaba todo el esquema a 1FN.
-- En la práctica: el peso de 'precio' se repetía idéntico en cada zona
-- de la corrida, y corregirlo obligaba a actualizar N filas confiando en
-- que ninguna quedara distinta.
CREATE TABLE accesibilidad_pesos (
    corrida_id          UUID NOT NULL REFERENCES analisis_corridas(id) ON DELETE CASCADE,
    componente          componente_accesibilidad NOT NULL,
    peso                NUMERIC(5,4) NOT NULL CHECK (peso BETWEEN 0 AND 1),
    PRIMARY KEY (corrida_id, componente)
);
COMMENT ON TABLE accesibilidad_pesos IS 'Ponderación de cada componente del índice, una vez por corrida. Que los pesos de una corrida sumen 1 requiere trigger: no es expresable como CHECK.';

CREATE TABLE accesibilidad_componentes (
    accesibilidad_id    UUID NOT NULL REFERENCES accesibilidad_zona(id) ON DELETE CASCADE,
    componente          componente_accesibilidad NOT NULL,
    valor               NUMERIC(10,4) NOT NULL,
    PRIMARY KEY (accesibilidad_id, componente)
);
COMMENT ON TABLE accesibilidad_componentes IS 'Valor medido de cada componente para una zona: precio, ingreso del segmento, disponibilidad y cobertura de básicos. El peso está en accesibilidad_pesos.';

-- El desglose completo "valor x peso = aporte" que antes se leía de una
-- sola tabla sigue disponible, ahora sin redundancia.
CREATE VIEW v_accesibilidad_desglose AS
SELECT a.id AS accesibilidad_id, a.corrida_id, a.zona_id, a.indice,
       c.componente, c.valor, w.peso,
       round(c.valor * w.peso, 4) AS aporte
FROM accesibilidad_zona a
JOIN accesibilidad_componentes c ON c.accesibilidad_id = a.id
JOIN accesibilidad_pesos w ON w.corrida_id = a.corrida_id
                          AND w.componente = c.componente;
COMMENT ON VIEW v_accesibilidad_desglose IS 'Explica el índice de accesibilidad componente por componente. RN: el índice nunca se reduce a "precio bajo".';

-- --- M13 Simulación --------------------------------------------------
CREATE TABLE escenarios (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre              VARCHAR(120) NOT NULL,
    descripcion         TEXT,
    escenario_base_id   UUID REFERENCES escenarios(id),  -- contra cuál se compara
    corrida_id          UUID REFERENCES analisis_corridas(id),
    zona_id             UUID REFERENCES zonas(id),
    creado_por          UUID NOT NULL REFERENCES usuarios(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nombre, creado_por)
);
COMMENT ON TABLE escenarios IS 'Escenario de simulación (M13). escenario_base_id permite comparar contra otro.';

CREATE TYPE tipo_cambio_escenario AS ENUM ('precio','empaque','descuento','disponibilidad');

CREATE TABLE escenario_cambios (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escenario_id        UUID NOT NULL REFERENCES escenarios(id) ON DELETE CASCADE,
    presentacion_id     UUID NOT NULL REFERENCES producto_presentaciones(id),
    tipo                tipo_cambio_escenario NOT NULL,
    valor_anterior      NUMERIC(12,4),
    valor_nuevo         NUMERIC(12,4) NOT NULL,
    UNIQUE (escenario_id, presentacion_id, tipo)
);
COMMENT ON TABLE escenario_cambios IS 'Modificaciones aplicadas en el escenario: qué se cambió y de cuánto a cuánto.';

CREATE TABLE escenario_resultados (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escenario_id        UUID NOT NULL REFERENCES escenarios(id) ON DELETE CASCADE,
    indicador_id        SMALLINT NOT NULL REFERENCES indicadores(id),
    zona_id             UUID REFERENCES zonas(id),
    valor_base          NUMERIC(16,4) NOT NULL,
    valor_simulado      NUMERIC(16,4) NOT NULL,
    variacion_pct       NUMERIC(10,4) GENERATED ALWAYS AS (
        CASE WHEN valor_base = 0 THEN NULL
             ELSE (valor_simulado - valor_base) / valor_base * 100 END
    ) STORED,
    UNIQUE NULLS NOT DISTINCT (escenario_id, indicador_id, zona_id)
);
COMMENT ON TABLE escenario_resultados IS 'Impacto estimado del escenario sobre demanda, ingreso y accesibilidad. La variación se calcula sola.';

-- --- M14 Recomendaciones --------------------------------------------
CREATE TYPE estatus_recomendacion AS ENUM ('propuesta','aceptada','descartada');

CREATE TABLE recomendaciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corrida_id          UUID REFERENCES analisis_corridas(id),
    escenario_id        UUID REFERENCES escenarios(id),
    zona_id             UUID REFERENCES zonas(id),
    titulo              VARCHAR(200) NOT NULL,
    -- Las cuatro preguntas que toda recomendación debe responder.
    que_recomienda      TEXT NOT NULL,
    por_que             TEXT NOT NULL,
    impacto_estimado    TEXT NOT NULL,
    estatus             estatus_recomendacion NOT NULL DEFAULT 'propuesta',
    generada_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE recomendaciones IS 'Recomendación de un motor de reglas (no IA). Debe explicar qué, por qué, con qué datos y qué impacto estima.';

-- "Con qué datos": evidencia que respalda la recomendación.
CREATE TABLE recomendacion_evidencias (
    recomendacion_id    UUID NOT NULL REFERENCES recomendaciones(id) ON DELETE CASCADE,
    dimension           dimension_analisis NOT NULL,
    referencia_id       TEXT NOT NULL,
    descripcion         TEXT NOT NULL,
    PRIMARY KEY (recomendacion_id, dimension, referencia_id)
);
COMMENT ON TABLE recomendacion_evidencias IS 'Datos concretos que sustentan cada recomendación.';

-- =====================================================================
-- 15. AUDITORÍA (RN-13)
--     Antes guardaba el estado previo y posterior como dos JSONB. Eso
--     hace imposible preguntar "¿quién cambió el precio de este
--     producto?" sin recorrer JSON. Ahora el evento y sus campos
--     modificados están separados y son consultables.
-- =====================================================================

CREATE TYPE accion_auditoria AS ENUM ('insert','update','delete','login','importacion');

CREATE TABLE auditoria (
    id                  BIGSERIAL PRIMARY KEY,
    usuario_id          UUID REFERENCES usuarios(id),
    rol_id              SMALLINT REFERENCES roles(id),
    tabla_afectada      VARCHAR(80) NOT NULL,
    registro_id         TEXT,
    accion              accion_auditoria NOT NULL,
    descripcion         TEXT,
    direccion_ip        INET,
    fecha               TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auditoria IS 'Evento auditable: quién, qué acción, sobre qué entidad y cuándo. Append-only: no se actualiza ni se borra.';
COMMENT ON COLUMN auditoria.rol_id IS 'Rol con el que actuaba el usuario EN EL INSTANTE del evento. No es copia redundante de usuarios.rol_id (eso sería una dependencia transitiva): el rol del usuario puede cambiar después y la bitácora no debe cambiar con él.';

CREATE INDEX idx_auditoria_tabla_registro ON auditoria(tabla_afectada, registro_id);
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id);
CREATE INDEX idx_auditoria_fecha ON auditoria(fecha DESC);

CREATE TABLE auditoria_cambios (
    auditoria_id        BIGINT NOT NULL REFERENCES auditoria(id) ON DELETE CASCADE,
    campo               VARCHAR(80) NOT NULL,
    valor_previo        TEXT,
    valor_posterior     TEXT,
    PRIMARY KEY (auditoria_id, campo)
);
COMMENT ON TABLE auditoria_cambios IS 'Campos modificados por el evento. Permite consultar el historial de un campo concreto sin recorrer JSON.';

CREATE INDEX idx_auditoria_cambios_campo ON auditoria_cambios(campo);

-- =====================================================================
-- 16. VISTAS PARA EL DASHBOARD DE NEGOCIO
--     Cada KPI del tablero tiene aquí de dónde salir. Son vistas, no
--     tablas: no duplican datos y siempre reflejan el estado actual.
-- =====================================================================

CREATE VIEW v_dashboard_kpis_generales AS
SELECT
    (SELECT count(*) FROM transacciones)                          AS transacciones_analizadas,
    (SELECT count(*) FROM canastas)                               AS canastas_construidas,
    (SELECT round(avg(valor_total), 2)      FROM canastas)        AS ticket_promedio,
    (SELECT round(avg(numero_productos), 2) FROM canastas)        AS productos_por_canasta,
    (SELECT round(avg(unidades_totales), 2) FROM canastas)        AS unidades_por_transaccion,
    (SELECT count(DISTINCT zona_id)         FROM canastas)        AS zonas_analizadas,
    (SELECT count(DISTINCT p.id)
       FROM productos p
       JOIN producto_presentaciones pp ON pp.producto_id = p.id
       JOIN inventario i ON i.presentacion_id = pp.id
      WHERE p.es_canasta_basica AND i.stock_disponible > 0)       AS productos_basicos_disponibles;
COMMENT ON VIEW v_dashboard_kpis_generales IS 'KPIs generales del tablero: transacciones, canastas, ticket promedio, productos por canasta, zonas y básicos disponibles.';

CREATE VIEW v_dashboard_gasto_categoria AS
SELECT c.id AS categoria_id, c.nombre AS categoria,
       k.zona_id, k.segmento_ingreso_id,
       date_trunc('month', k.fecha)::date AS periodo,
       sum(d.subtotal)      AS gasto,
       sum(d.cantidad)      AS unidades,
       count(DISTINCT k.id) AS canastas
FROM canastas k
JOIN transacciones_detalle d ON d.transaccion_id = k.transaccion_id
JOIN producto_presentaciones pp ON pp.id = d.presentacion_id
JOIN productos p ON p.id = pp.producto_id
JOIN categorias_producto c ON c.id = p.categoria_id
GROUP BY c.id, c.nombre, k.zona_id, k.segmento_ingreso_id, date_trunc('month', k.fecha);
COMMENT ON VIEW v_dashboard_gasto_categoria IS 'Gasto por categoría, con corte por zona, segmento y mes. Alimenta "categorías principales".';

CREATE VIEW v_dashboard_asociaciones AS
SELECT r.id AS regla_id, r.corrida_id, r.soporte, r.confianza, r.lift,
       (SELECT string_agg(p.nombre, ' + ' ORDER BY p.nombre)
          FROM regla_asociacion_items i
          JOIN productos p ON p.id = i.producto_id
         WHERE i.regla_id = r.id AND i.lado = 'antecedente') AS antecedente,
       (SELECT string_agg(p.nombre, ' + ' ORDER BY p.nombre)
          FROM regla_asociacion_items i
          JOIN productos p ON p.id = i.producto_id
         WHERE i.regla_id = r.id AND i.lado = 'consecuente') AS consecuente
FROM reglas_asociacion r;
COMMENT ON VIEW v_dashboard_asociaciones IS 'Reglas de asociación en texto legible para el tablero, sin perder la forma normalizada de abajo.';

CREATE VIEW v_dashboard_accesibilidad_zona AS
SELECT DISTINCT ON (a.zona_id)
       a.zona_id, z.nombre AS zona, m.nombre AS municipio,
       a.indice, c.ejecutada_en, c.id AS corrida_id
FROM accesibilidad_zona a
JOIN analisis_corridas c ON c.id = a.corrida_id
JOIN zonas z ON z.id = a.zona_id
JOIN municipios m ON m.id = z.municipio_id
WHERE c.estado = 'completada'
ORDER BY a.zona_id, c.ejecutada_en DESC;
COMMENT ON VIEW v_dashboard_accesibilidad_zona IS 'Accesibilidad vigente por zona: toma solo la corrida completada más reciente de cada una.';

CREATE VIEW v_dashboard_elasticidad AS
SELECT e.clasificacion, count(*) AS productos,
       round(avg(e.valor), 4) AS elasticidad_promedio
FROM elasticidades e
JOIN analisis_corridas c ON c.id = e.corrida_id
WHERE c.estado = 'completada'
GROUP BY e.clasificacion;
COMMENT ON VIEW v_dashboard_elasticidad IS 'Elasticidad promedio y conteo por clasificación. Los "productos más sensibles" salen de elasticidades ordenada por abs(valor).';

CREATE VIEW v_variacion_precios AS
SELECT p.presentacion_id, p.tienda_id, p.fecha_vigencia_desde,
       p.precio AS precio_actual,
       lag(p.precio) OVER w AS precio_anterior,
       CASE
           WHEN lag(p.precio) OVER w IS NULL OR lag(p.precio) OVER w = 0 THEN NULL
           ELSE round((p.precio - lag(p.precio) OVER w) / lag(p.precio) OVER w * 100, 2)
       END AS variacion_pct
FROM precios p
WINDOW w AS (PARTITION BY p.presentacion_id, p.tienda_id ORDER BY p.fecha_vigencia_desde);
COMMENT ON VIEW v_variacion_precios IS 'Variación porcentual entre precios consecutivos. Es posible porque el histórico no se sobrescribe.';

CREATE VIEW v_dashboard_simulacion AS
SELECT e.id AS escenario_id, e.nombre, e.zona_id, e.created_at,
       i.clave AS indicador, i.nombre AS indicador_nombre,
       r.valor_base, r.valor_simulado, r.variacion_pct
FROM escenarios e
JOIN escenario_resultados r ON r.escenario_id = e.id
JOIN indicadores i ON i.id = r.indicador_id;
COMMENT ON VIEW v_dashboard_simulacion IS 'Impacto estimado por escenario (demanda, ingreso, accesibilidad).';

COMMIT;
