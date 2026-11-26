-- =====================================================================
-- Sprint 4 · data-governance-service (T-14, D-43, D-47)
--
-- Tablas propias del servicio de gobierno de datos: fuentes y sus versiones,
-- linaje de cada recurso producido y las políticas de retención de D-43.
-- Contrato: docs/contratos/data-governance-service.md (DG-1 a DG-11).
--
-- Idempotente: se puede correr varias veces (infra/migrar-postgres.sh corre
-- todas las migraciones en orden). No toca tablas de otros servicios; solo
-- las referencia por llave foránea (`usuarios`), igual que la bitácora.
--
--   docker exec -i retail_postgres psql -U retail_user -d retaildb \
--     < db/migraciones/sprint4_data_governance.sql
-- =====================================================================

BEGIN;

-- --- Fuentes de datos (DG-1) -----------------------------------------

CREATE TABLE IF NOT EXISTS fuentes_datos (
    clave           VARCHAR(40) PRIMARY KEY,
    nombre          VARCHAR(120) NOT NULL,
    tipo            VARCHAR(30) NOT NULL,
    servicio_dueno  VARCHAR(40) NOT NULL,
    descripcion     TEXT,
    activa          BOOLEAN NOT NULL DEFAULT true,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    creado_por      UUID REFERENCES usuarios(id),
    actualizado_en  TIMESTAMPTZ,
    CONSTRAINT chk_fuente_clave CHECK (clave ~ '^[a-z0-9-]{3,40}$'),
    CONSTRAINT chk_fuente_tipo CHECK (tipo IN ('importacion', 'operacion', 'captura', 'referencia_externa', 'sintetico'))
);
COMMENT ON TABLE fuentes_datos IS 'Fuentes de datos (DG-1). La clave no cambia; una fuente nunca se borra, se desactiva. creado_por NULL en las sembradas. Dueño: data-governance-service.';

-- --- Versiones de cada fuente (DG-2): solo se anexan -----------------

CREATE TABLE IF NOT EXISTS fuente_versiones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuente_clave    VARCHAR(40) NOT NULL REFERENCES fuentes_datos(clave),
    version         VARCHAR(100) NOT NULL,
    descripcion     VARCHAR(300),
    origen          VARCHAR(10) NOT NULL,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    creado_por      UUID REFERENCES usuarios(id),
    CONSTRAINT uq_fuente_version UNIQUE (fuente_clave, version),
    CONSTRAINT chk_fuente_version_origen CHECK (origen IN ('manual', 'linaje'))
);
COMMENT ON TABLE fuente_versiones IS 'Versiones de cada fuente (DG-2): manual (Administrador) o linaje (se crea al registrar un linaje con una versión nueva). Solo se anexa. Dueño: data-governance-service.';
CREATE INDEX IF NOT EXISTS idx_fuente_versiones_reciente ON fuente_versiones (fuente_clave, creado_en DESC);

-- --- Linaje (DG-3 a DG-6): solo se anexa -----------------------------

CREATE TABLE IF NOT EXISTS linaje_registros (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    servicio        VARCHAR(40) NOT NULL,
    tipo_recurso    VARCHAR(20) NOT NULL,
    recurso_id      VARCHAR(100) NOT NULL,
    descripcion     VARCHAR(300),
    fuente_clave    VARCHAR(40) NOT NULL,
    fuente_version  VARCHAR(100) NOT NULL,
    ocurrido_en     TIMESTAMPTZ NOT NULL,
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    correlation_id  VARCHAR(100),
    registrado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_linaje_recurso UNIQUE (servicio, tipo_recurso, recurso_id),
    CONSTRAINT fk_linaje_fuente_version FOREIGN KEY (fuente_clave, fuente_version)
        REFERENCES fuente_versiones (fuente_clave, version),
    CONSTRAINT chk_linaje_tipo CHECK (tipo_recurso IN ('importacion', 'version_segmento', 'corrida'))
);
COMMENT ON TABLE linaje_registros IS 'Un registro por recurso producido (importación, versión de segmento o corrida), con su fuente y versión, quién (usuario_id, D-26), cuándo y el X-Correlation-Id. Idempotente por (servicio, tipo_recurso, recurso_id) (DG-3). Solo se anexa. Dueño: data-governance-service.';
CREATE INDEX IF NOT EXISTS idx_linaje_usuario ON linaje_registros (usuario_id, registrado_en DESC);
CREATE INDEX IF NOT EXISTS idx_linaje_reciente ON linaje_registros (registrado_en DESC);
CREATE INDEX IF NOT EXISTS idx_linaje_fuente ON linaje_registros (fuente_clave);

CREATE TABLE IF NOT EXISTS linaje_insumos (
    registro_id     UUID NOT NULL REFERENCES linaje_registros(id),
    orden           SMALLINT NOT NULL,
    servicio        VARCHAR(40) NOT NULL,
    tipo_recurso    VARCHAR(20) NOT NULL,
    recurso_id      VARCHAR(100) NOT NULL,
    PRIMARY KEY (registro_id, servicio, tipo_recurso, recurso_id),
    CONSTRAINT chk_insumo_tipo CHECK (tipo_recurso IN ('importacion', 'version_segmento', 'corrida'))
);
COMMENT ON TABLE linaje_insumos IS 'De qué otros recursos salió cada registro de linaje (DG-5). Un insumo puede no tener linaje propio todavía. Solo se anexa. Dueño: data-governance-service.';
-- El árbol de origen busca el registro de cada insumo por su llave natural (uq_linaje_recurso).

-- --- Políticas de retención de D-43: solo lectura --------------------

CREATE TABLE IF NOT EXISTS politicas_retencion (
    conjunto        VARCHAR(40) PRIMARY KEY,
    servicio_dueno  VARCHAR(40) NOT NULL,
    plazo           VARCHAR(10),
    base            VARCHAR(60) NOT NULL,
    accion_dueno    TEXT NOT NULL,
    decision        VARCHAR(10) NOT NULL DEFAULT 'D-43',
    orden           SMALLINT NOT NULL,
    CONSTRAINT chk_politica_plazo CHECK (plazo IS NULL OR plazo ~ '^P[0-9]+[YMD]$')
);
COMMENT ON TABLE politicas_retencion IS 'Políticas de retención de D-43 (plazo ISO 8601; NULL = nunca vence). El servicio dueño de cada conjunto la aplica sobre su almacén. Solo lectura. Dueño: data-governance-service.';

-- --- Solo se anexa: la base lo impide, no solo el código --------------

CREATE OR REPLACE FUNCTION gobierno_solo_anexa() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'La tabla % solo se anexa (D-43): no admite %.', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE TRIGGER trg_fuente_versiones_solo_anexa
    BEFORE UPDATE OR DELETE ON fuente_versiones
    FOR EACH ROW EXECUTE FUNCTION gobierno_solo_anexa();
CREATE OR REPLACE TRIGGER trg_linaje_registros_solo_anexa
    BEFORE UPDATE OR DELETE ON linaje_registros
    FOR EACH ROW EXECUTE FUNCTION gobierno_solo_anexa();
CREATE OR REPLACE TRIGGER trg_linaje_insumos_solo_anexa
    BEFORE UPDATE OR DELETE ON linaje_insumos
    FOR EACH ROW EXECUTE FUNCTION gobierno_solo_anexa();
-- Una fuente se desactiva (UPDATE de `activa`), pero nunca se borra (DG-1).
CREATE OR REPLACE TRIGGER trg_fuentes_datos_sin_borrado
    BEFORE DELETE ON fuentes_datos
    FOR EACH ROW EXECUTE FUNCTION gobierno_solo_anexa();

-- --- Semillas (contrato: fuentes sembradas y políticas de D-43) -------

INSERT INTO fuentes_datos (clave, nombre, tipo, servicio_dueno) VALUES
    ('ventas-archivo', 'Importación de ventas por archivo (CSV, JSON, XML)', 'importacion', 'transactions-ingestion-service'),
    ('ventas-core-process', 'Transacciones confirmadas y canastas', 'operacion', 'core-process-service'),
    ('capturas-campo', 'Capturas de campo: disponibilidad, precio observado y visitas', 'captura', 'availability-service'),
    ('inegi-enigh', 'INEGI ENIGH: ingreso corriente trimestral por hogar', 'referencia_externa', 'income-segmentation-service'),
    ('generador-sintetico', 'Generador de datos del Parcial 3 (con semilla)', 'sintetico', 'data-governance-service'),
    ('seed-demo', 'Datos de prueba del repositorio (data_retail.sql y CSV de 100 canastas)', 'sintetico', 'data-governance-service')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO fuente_versiones (fuente_clave, version, descripcion, origen) VALUES
    ('inegi-enigh', 'ENIGH 2022', 'Fuente declarada de los segmentos de ingreso del seed.', 'manual'),
    ('generador-sintetico', 'v1 semilla 42', 'db/generar_datos_parcial3.py con la semilla por defecto.', 'manual'),
    ('seed-demo', 'ca8903c', 'db/data_retail.sql y db/datos_prueba_100_canastas.csv en ese commit.', 'manual')
ON CONFLICT ON CONSTRAINT uq_fuente_version DO NOTHING;

INSERT INTO politicas_retencion (conjunto, servicio_dueno, plazo, base, accion_dueno, orden) VALUES
    ('transacciones', 'core-process-service', 'P3Y', 'fecha de la venta',
     'El dueño decide cómo aplicarla sobre su almacén (D-43 fija el plazo).', 1),
    ('capturas_disponibilidad', 'availability-service', 'P1Y', 'capturedAt',
     'El dueño decide cómo aplicarla sobre su almacén (D-43 fija el plazo).', 2),
    ('observaciones_precio', 'pricing-service', 'P1Y', 'fecha de la observación',
     'El dueño decide cómo aplicarla sobre su almacén (D-43 fija el plazo).', 3),
    ('visitas_campo', 'catalog-service', 'P1Y', 'fecha de la visita',
     'El dueño decide cómo aplicarla sobre su almacén (D-43 fija el plazo).', 4),
    ('notificaciones', 'notifications-service', 'P90D', 'createdAt',
     'Ya implementado: un job diario archiva lo mayor a 90 días y nunca borra.', 5),
    ('bitacora', 'audit-service', NULL, '—',
     'Sin borrado: la bitácora es inmutable (D-43).', 6)
ON CONFLICT (conjunto) DO NOTHING;

COMMIT;
