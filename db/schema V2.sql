-- =====================================================================
-- Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista
-- Schema inicial de base de datos relacional (PostgreSQL)
--
-- Fuentes de diseño:
--   - S0_Matriz_de_Perfiles_y_Permisos.pdf   (roles, módulos, permisos)
--   - Contexto_del_proyecto_y_actividades.pdf (alcance, stack, entregables)
--   - S0_Reglas_de_Negocio.pdf                (RN-01 a RN-15)
--   - Historias_de_Usuario.docx                (HU-01 a HU-48)
--
-- Alcance de este archivo: modelo relacional base (tiendas, zonas,
-- productos, precios, transacciones, usuarios y roles) más las tablas
-- de soporte mínimas necesarias para cumplir las reglas de negocio
-- (proveedores, segmentos de ingreso, auditoría, límites de precio,
-- exclusiones de asociación, inventario y perfil de consumo).
--
-- Este archivo define únicamente estructura (DDL): tipos, tablas,
-- llaves, índices y triggers. No incluye datos de prueba/semilla.
--
-- Los resultados de los algoritmos (Apriori, FP-Growth, clustering,
-- elasticidad, simulaciones) y datos semiestructurados (encuestas,
-- logs) se modelan en MongoDB según el stack tecnológico definido y
-- no se incluyen en este schema relacional.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Extensiones
-- ---------------------------------------------------------------------
-- gen_random_uuid() es una función nativa del núcleo desde PostgreSQL 13
-- (dejó de requerir la extensión pgcrypto). Como el proyecto usa
-- PostgreSQL 16, NO se necesita CREATE EXTENSION pgcrypto aquí. Si en
-- algún entorno usan una versión anterior a la 13, descomenta la línea
-- siguiente (requiere que el paquete contrib esté instalado en el
-- servidor, ej. `postgresql-contrib` / `postgresql16-contrib`):
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Función utilitaria: mantiene updated_at en cada UPDATE
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 1. ROLES, MÓDULOS Y PERMISOS
--    Traduce a datos la S0_Matriz_de_Perfiles_y_Permisos.
-- =====================================================================

CREATE TABLE roles (
    id              SMALLSERIAL PRIMARY KEY,
    nombre          VARCHAR(40)  NOT NULL UNIQUE,
    descripcion     TEXT         NOT NULL
);
COMMENT ON TABLE roles IS 'Perfiles del sistema definidos en S0_Matriz_de_Perfiles_y_Permisos.';

CREATE TABLE modulos (
    id              SMALLSERIAL PRIMARY KEY,
    nombre          VARCHAR(60)  NOT NULL UNIQUE,
    descripcion     TEXT
);
COMMENT ON TABLE modulos IS 'Módulos/funciones del sistema listados en la matriz de permisos.';

CREATE TYPE nivel_permiso AS ENUM (
    'total',          -- crear, leer, actualizar y eliminar
    'lectura_actualiza', -- leer y actualizar (sin crear ni eliminar)
    'lectura',         -- solo consulta
    'propone',         -- crea/edita, queda pendiente de aprobación
    'aprueba',         -- revisa y aprueba/rechaza lo propuesto
    'lectura_propios', -- lectura restringida a registros propios (ej. Proveedor)
    'sin_acceso'
);

CREATE TABLE rol_modulo_permiso (
    rol_id          SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    modulo_id       SMALLINT NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
    nivel           nivel_permiso NOT NULL DEFAULT 'sin_acceso',
    PRIMARY KEY (rol_id, modulo_id)
);
COMMENT ON TABLE rol_modulo_permiso IS 'Matriz de permisos rol x módulo (RBAC data-driven).';

-- =====================================================================
-- 2. PROVEEDORES Y USUARIOS
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
COMMENT ON TABLE proveedores IS 'Empresas proveedoras externas (RN-14). HU-17/HU-18.';

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
COMMENT ON TABLE usuarios IS 'Usuarios internos y externos (proveedores) del sistema. HU-01, HU-02.';

CREATE TRIGGER trg_usuarios_updated_at
    BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_usuarios_rol ON usuarios(rol_id);

-- =====================================================================
-- 3. ZONAS (Área Metropolitana de Monterrey) Y SEGMENTOS DE INGRESO
--    RN-01, RN-02
-- =====================================================================

CREATE TABLE municipios (
    id              SMALLSERIAL PRIMARY KEY,
    nombre          VARCHAR(80) NOT NULL UNIQUE
);
COMMENT ON TABLE municipios IS 'Los 16 municipios principales del AMM usados como base territorial (RN-02).';

CREATE TABLE segmentos_ingreso (
    id              SMALLSERIAL PRIMARY KEY,
    nombre          VARCHAR(60) NOT NULL UNIQUE,
    ingreso_min     NUMERIC(12,2) NOT NULL,
    ingreso_max     NUMERIC(12,2),
    descripcion     TEXT,
    CONSTRAINT chk_segmento_rango CHECK (ingreso_max IS NULL OR ingreso_max > ingreso_min)
);
COMMENT ON TABLE segmentos_ingreso IS 'Rangos y criterios de clasificación por nivel de ingreso (RN-01). HU-29.';

CREATE TABLE zonas (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                  VARCHAR(120) NOT NULL,
    municipio_id            SMALLINT NOT NULL REFERENCES municipios(id),
    segmento_ingreso_id     SMALLINT REFERENCES segmentos_ingreso(id),
    cluster_algoritmo       VARCHAR(40),   -- ej. 'kmeans_v1' (trazabilidad del clustering, RN-02)
    cluster_valor           INTEGER,       -- etiqueta de cluster asignada
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nombre, municipio_id)
);
COMMENT ON TABLE zonas IS 'Zonas geográficas clasificadas por municipio y segmento de ingreso (RN-01, RN-02). HU-08, HU-09.';

CREATE TRIGGER trg_zonas_updated_at
    BEFORE UPDATE ON zonas
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_zonas_municipio ON zonas(municipio_id);
CREATE INDEX idx_zonas_segmento ON zonas(segmento_ingreso_id);

-- =====================================================================
-- 4. TIENDAS
-- =====================================================================

CREATE TYPE formato_tienda AS ENUM ('supermercado','minimarket','tienda_conveniencia','mayorista','otro');

CREATE TABLE tiendas (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre              VARCHAR(150) NOT NULL,
    direccion           TEXT NOT NULL,
    zona_id             UUID NOT NULL REFERENCES zonas(id),
    proveedor_id        UUID REFERENCES proveedores(id),  -- NULL si la tienda no está asociada a un proveedor
    formato             formato_tienda NOT NULL DEFAULT 'otro',
    numero_sucursal     VARCHAR(20),
    tiene_web_propia    BOOLEAN NOT NULL DEFAULT FALSE,
    gestion_datos_web   TEXT,        -- descripción de cómo se gestionan los datos si tiene web propia (RN-01)
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE tiendas IS 'Tiendas/sucursales físicas del negocio (RN-01). HU-04, HU-05, HU-06, HU-07.';

CREATE TRIGGER trg_tiendas_updated_at
    BEFORE UPDATE ON tiendas
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tiendas_zona ON tiendas(zona_id);
CREATE INDEX idx_tiendas_activo ON tiendas(activo);
CREATE INDEX idx_tiendas_proveedor ON tiendas(proveedor_id) WHERE proveedor_id IS NOT NULL;

-- =====================================================================
-- 5. CATEGORÍAS Y PRODUCTOS
--    RN-04, RN-10, RN-11
-- =====================================================================

CREATE TABLE categorias_producto (
    id                  SMALLSERIAL PRIMARY KEY,
    nombre              VARCHAR(80) NOT NULL UNIQUE,
    categoria_padre_id  SMALLINT REFERENCES categorias_producto(id),
    descripcion         TEXT
);
COMMENT ON TABLE categorias_producto IS 'Categorías y subcategorías de producto; soporta criterios de sustituibilidad (RN-11).';

CREATE TYPE estatus_producto AS ENUM ('activo','pendiente_aprobacion','rechazado','inactivo');

CREATE TABLE productos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku                 VARCHAR(40) NOT NULL UNIQUE,
    nombre              VARCHAR(150) NOT NULL,
    descripcion         TEXT,
    categoria_id        SMALLINT NOT NULL REFERENCES categorias_producto(id),
    unidad_medida       VARCHAR(20) NOT NULL,     -- ej. 'pieza','kg','litro'
    imagen_url          TEXT,
    es_canasta_basica   BOOLEAN NOT NULL DEFAULT FALSE,  -- RN-04
    estatus             estatus_producto NOT NULL DEFAULT 'pendiente_aprobacion',
    proveedor_id        UUID REFERENCES proveedores(id),  -- NULL si fue dado de alta internamente
    aprobado_por        UUID REFERENCES usuarios(id),
    motivo_rechazo      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_producto_rechazo CHECK (
        (estatus = 'rechazado' AND motivo_rechazo IS NOT NULL) OR (estatus <> 'rechazado')
    )
);
COMMENT ON TABLE productos IS 'Catálogo de productos, incluye flujo de alta por proveedor (RN-04, RN-11). HU-11 a HU-16.';

CREATE TRIGGER trg_productos_updated_at
    BEFORE UPDATE ON productos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_productos_categoria ON productos(categoria_id);
CREATE INDEX idx_productos_proveedor ON productos(proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX idx_productos_estatus ON productos(estatus);

-- =====================================================================
-- 6. INVENTARIO POR TIENDA (soporte a RN-04: canastas requieren stock)
-- =====================================================================

CREATE TABLE inventario (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tienda_id           UUID NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
    producto_id         UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    stock_disponible    INTEGER NOT NULL DEFAULT 0 CHECK (stock_disponible >= 0),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tienda_id, producto_id)
);
COMMENT ON TABLE inventario IS 'Stock por tienda y producto; condiciona la construcción de canastas (RN-04) y la sustitución por desabasto (RN-11).';

CREATE INDEX idx_inventario_producto ON inventario(producto_id);

-- =====================================================================
-- 7. PRECIOS
--    RN-06, RN-08, RN-10
-- =====================================================================

CREATE TYPE origen_precio AS ENUM ('interno','propuesta_proveedor_aprobada');

CREATE TABLE precios (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id         UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    tienda_id           UUID NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
    precio              NUMERIC(12,2) NOT NULL CHECK (precio > 0),
    fecha_vigencia_desde DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_vigencia_hasta DATE,
    vigente             BOOLEAN NOT NULL DEFAULT TRUE,
    origen              origen_precio NOT NULL DEFAULT 'interno',
    creado_por          UUID REFERENCES usuarios(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_precio_vigencia CHECK (
        fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde
    )
);
COMMENT ON TABLE precios IS 'Historial versionado de precios por producto/tienda (RN-06). Solo un registro vigente=TRUE por par producto/tienda. HU-20, HU-23, HU-24.';

-- Garantiza un único precio vigente por producto+tienda
CREATE UNIQUE INDEX uq_precios_vigente_por_producto_tienda
    ON precios(producto_id, tienda_id)
    WHERE vigente;

CREATE INDEX idx_precios_producto ON precios(producto_id);
CREATE INDEX idx_precios_tienda ON precios(tienda_id);
CREATE INDEX idx_precios_vigencia ON precios(fecha_vigencia_desde, fecha_vigencia_hasta);

CREATE TYPE estatus_propuesta AS ENUM ('pendiente','aprobado','rechazado');

CREATE TABLE precios_propuestos_proveedor (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id         UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    proveedor_id        UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
    precio_propuesto    NUMERIC(12,2) NOT NULL CHECK (precio_propuesto > 0),
    unidad_compra       VARCHAR(30),          -- ej. 'tonelada','caja','pieza' (RN-14)
    estatus             estatus_propuesta NOT NULL DEFAULT 'pendiente',
    motivo_rechazo      TEXT,
    revisado_por        UUID REFERENCES usuarios(id),
    revisado_en         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_precio_propuesto_rechazo CHECK (
        (estatus = 'rechazado' AND motivo_rechazo IS NOT NULL) OR (estatus <> 'rechazado')
    )
);
COMMENT ON TABLE precios_propuestos_proveedor IS 'Precios propuestos por proveedores para comparación y decisión de compra (RN-14). HU-21, HU-22, HU-40.';

CREATE INDEX idx_precios_prop_producto ON precios_propuestos_proveedor(producto_id);
CREATE INDEX idx_precios_prop_proveedor ON precios_propuestos_proveedor(proveedor_id);
CREATE INDEX idx_precios_prop_estatus ON precios_propuestos_proveedor(estatus);

-- Límites/control de variación de precio por zona (RN-06, RN-10).
-- Los valores (variacion_max_pct, precio_min, precio_max) se calculan
-- internamente por el motor analítico y se editan/ajustan por el
-- rol Administrador; cada edición se refleja también en auditoria (RN-13).
CREATE TABLE limites_precio_zona (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zona_id             UUID NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
    producto_id         UUID REFERENCES productos(id) ON DELETE CASCADE, -- NULL = aplica a toda la zona
    variacion_max_pct   NUMERIC(5,2) NOT NULL CHECK (variacion_max_pct >= 0),
    precio_min          NUMERIC(12,2),
    precio_max          NUMERIC(12,2),
    actualizado_por     UUID REFERENCES usuarios(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_limite_precio_rango CHECK (
        precio_min IS NULL OR precio_max IS NULL OR precio_max >= precio_min
    ),
    UNIQUE (zona_id, producto_id)
);
COMMENT ON TABLE limites_precio_zona IS 'Rangos y variación máxima de precio permitida por zona/producto (RN-06, RN-10).';

-- =====================================================================
-- 8. REGLAS DURAS DE EXCLUSIÓN PARA ASOCIACIÓN (RN-10)
-- =====================================================================

CREATE TABLE reglas_exclusion_asociacion (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_a_id      SMALLINT NOT NULL REFERENCES categorias_producto(id),
    categoria_b_id      SMALLINT NOT NULL REFERENCES categorias_producto(id),
    descripcion         TEXT,
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    creado_por          UUID REFERENCES usuarios(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_exclusion_categorias_distintas CHECK (categoria_a_id <> categoria_b_id),
    UNIQUE (categoria_a_id, categoria_b_id)
);
COMMENT ON TABLE reglas_exclusion_asociacion IS 'Reglas duras configurables por Administrador que excluyen asociaciones entre categorías (ej. limpieza vs. alimentos frescos). RN-10.';

-- =====================================================================
-- 9. CLIENTES Y PERFIL DE CONSUMO (RN-15)
-- =====================================================================

CREATE TYPE perfil_hogar AS ENUM ('vive_solo','depende_2_3_personas','depende_4_o_mas_personas');
CREATE TYPE frecuencia_compra AS ENUM ('diaria','cada_3_dias','semanal','quincenal','mensual');

CREATE TABLE clientes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                  VARCHAR(120),
    email                   VARCHAR(150) UNIQUE,
    telefono                VARCHAR(30),
    zona_id                 UUID REFERENCES zonas(id),
    segmento_ingreso_id     SMALLINT REFERENCES segmentos_ingreso(id),
    perfil_hogar            perfil_hogar,
    frecuencia_esperada     frecuencia_compra,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE clientes IS 'Usuario final registrado desde la app móvil; su perfil ajusta recomendaciones de canasta (RN-15).';

CREATE TRIGGER trg_clientes_updated_at
    BEFORE UPDATE ON clientes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_clientes_zona ON clientes(zona_id);
CREATE INDEX idx_clientes_segmento ON clientes(segmento_ingreso_id);

-- =====================================================================
-- 10. TRANSACCIONES
--     RN-03, RN-05
-- =====================================================================

CREATE TYPE canal_transaccion AS ENUM ('punto_venta','app_movil','web','otro');

CREATE TABLE transacciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folio               VARCHAR(40) NOT NULL,
    tienda_id           UUID NOT NULL REFERENCES tiendas(id),
    cliente_id          UUID REFERENCES clientes(id),
    usuario_captura_id  UUID REFERENCES usuarios(id),
    canal               canal_transaccion NOT NULL DEFAULT 'punto_venta',
    fecha               TIMESTAMPTZ NOT NULL DEFAULT now(),
    total               NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tienda_id, folio)
);
COMMENT ON TABLE transacciones IS 'Encabezado de transacción de venta, base para canastas e indicadores (RN-03). HU-25, HU-26, HU-27.';

CREATE INDEX idx_transacciones_tienda ON transacciones(tienda_id);
CREATE INDEX idx_transacciones_fecha ON transacciones(fecha);
CREATE INDEX idx_transacciones_cliente ON transacciones(cliente_id) WHERE cliente_id IS NOT NULL;

CREATE TABLE transacciones_detalle (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaccion_id      UUID NOT NULL REFERENCES transacciones(id) ON DELETE CASCADE,
    producto_id         UUID NOT NULL REFERENCES productos(id),
    cantidad            NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
    precio_unitario     NUMERIC(12,2) NOT NULL CHECK (precio_unitario > 0),
    subtotal            NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);
COMMENT ON TABLE transacciones_detalle IS 'Líneas de producto por transacción; insumo directo para canastas de consumo y reglas de asociación (RN-03, RN-05).';

CREATE INDEX idx_detalle_transaccion ON transacciones_detalle(transaccion_id);
CREATE INDEX idx_detalle_producto ON transacciones_detalle(producto_id);

-- =====================================================================
-- 11. AUDITORÍA Y TRAZABILIDAD (RN-13)
-- =====================================================================

CREATE TYPE accion_auditoria AS ENUM ('insert','update','delete');

CREATE TABLE auditoria (
    id                  BIGSERIAL PRIMARY KEY,
    usuario_id          UUID REFERENCES usuarios(id),
    rol_id              SMALLINT REFERENCES roles(id),
    tabla_afectada      VARCHAR(80) NOT NULL,
    registro_id         TEXT NOT NULL,
    accion              accion_auditoria NOT NULL,
    estado_previo       JSONB,
    estado_posterior    JSONB,
    fecha               TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auditoria IS 'Bitácora de cambios (usuario, rol, entidad, estado previo/posterior) requerida por RN-13. HU-46, HU-47, HU-48.';

CREATE INDEX idx_auditoria_tabla ON auditoria(tabla_afectada);
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id);
CREATE INDEX idx_auditoria_fecha ON auditoria(fecha);

COMMIT;