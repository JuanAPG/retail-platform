-- =====================================================================
-- Sprint 4 · income-segmentation-service (T-10, D-35)
--
-- Para una base que YA existe (volumen creado antes de este cambio).
-- `db/schema.sql` ya trae estas tablas para un volumen nuevo; este archivo
-- lleva una base vieja al mismo estado SIN recrear el volumen ni perder
-- datos. Es idempotente: se puede correr varias veces.
--
--   docker exec -i retail_postgres psql -U retail_user -d retaildb \
--     < db/migraciones/sprint4_income_segmentation.sql
-- =====================================================================

BEGIN;

ALTER TABLE segmentos_ingreso
    ADD COLUMN IF NOT EXISTS version_actual INTEGER NOT NULL DEFAULT 1 CHECK (version_actual >= 1);

CREATE TABLE IF NOT EXISTS segmento_versiones (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    segmento_id                 SMALLINT NOT NULL REFERENCES segmentos_ingreso(id) ON DELETE CASCADE,
    version                     INTEGER NOT NULL CHECK (version >= 1),
    nombre                      VARCHAR(60) NOT NULL,
    ingreso_min                 NUMERIC(12,2) NOT NULL,
    ingreso_max                 NUMERIC(12,2),
    fuente                      TEXT NOT NULL,
    frecuencia_actualizacion    VARCHAR(60) NOT NULL,
    relacion_zona               TEXT NOT NULL,
    limitaciones                TEXT NOT NULL,
    descripcion                 TEXT,
    vigente_desde               TIMESTAMPTZ NOT NULL DEFAULT now(),
    vigente_hasta               TIMESTAMPTZ,
    creado_por                  UUID REFERENCES usuarios(id),
    motivo_cambio               VARCHAR(300),
    UNIQUE (segmento_id, version),
    CONSTRAINT chk_segversion_rango CHECK (ingreso_max IS NULL OR ingreso_max > ingreso_min),
    CONSTRAINT chk_segversion_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
COMMENT ON TABLE segmento_versiones IS 'Versiones de cada segmento de ingreso, con su fuente y fecha (D-35). Solo se anexa. Dueño: income-segmentation-service.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_segmento_version_vigente
    ON segmento_versiones(segmento_id) WHERE vigente_hasta IS NULL;

ALTER TABLE zona_clasificaciones
    ADD COLUMN IF NOT EXISTS segmento_version INTEGER NOT NULL DEFAULT 1 CHECK (segmento_version >= 1);

-- Los segmentos que ya existían reciben su versión 1 con los valores de hoy.
INSERT INTO segmento_versiones
    (segmento_id, version, nombre, ingreso_min, ingreso_max, fuente,
     frecuencia_actualizacion, relacion_zona, limitaciones, descripcion)
SELECT s.id, s.version_actual, s.nombre, s.ingreso_min, s.ingreso_max, s.fuente,
       s.frecuencia_actualizacion, s.relacion_zona, s.limitaciones, s.descripcion
FROM segmentos_ingreso s
WHERE NOT EXISTS (
    SELECT 1 FROM segmento_versiones v
    WHERE v.segmento_id = s.id AND v.version = s.version_actual
);

COMMIT;
