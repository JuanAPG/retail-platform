-- =====================================================================
-- Sprint 4 · availability-service (T-11, D-38)
--
-- Para una base que YA existe (volumen creado antes de este cambio).
-- `db/schema.sql` ya trae esta tabla para un volumen nuevo; este archivo
-- lleva una base vieja al mismo estado SIN recrear el volumen ni perder
-- datos. Es idempotente: se puede correr varias veces.
--
--   docker exec -i retail_postgres psql -U retail_user -d retaildb \
--     < db/migraciones/sprint4_availability.sql
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS disponibilidad_capturas (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    captura_id          UUID NOT NULL UNIQUE,
    tienda_id           UUID NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
    presentacion_id     UUID NOT NULL REFERENCES producto_presentaciones(id) ON DELETE CASCADE,
    stock               NUMERIC(12,2) NOT NULL CHECK (stock >= 0),
    capturado_en        TIMESTAMPTZ NOT NULL,
    recibido_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    origen              VARCHAR(12) NOT NULL DEFAULT 'web' CHECK (origen IN ('movil','escritorio','web')),
    estado              VARCHAR(12) NOT NULL CHECK (estado IN ('aceptada','conflicto')),
    motivo              TEXT,
    capturado_por       UUID REFERENCES usuarios(id)
);
COMMENT ON TABLE disponibilidad_capturas IS 'Capturas de existencia (campo, escritorio o web), aceptadas o en conflicto (D-38, D-42). Solo se anexa. Dueño: availability-service.';

CREATE INDEX IF NOT EXISTS idx_dispcapturas_tienda_presentacion
    ON disponibilidad_capturas(tienda_id, presentacion_id, capturado_en DESC);
CREATE INDEX IF NOT EXISTS idx_dispcapturas_recibido ON disponibilidad_capturas(recibido_en DESC);

COMMENT ON TABLE inventario IS 'Existencia ACTUAL por tienda y presentación; actualizado_en es cuándo se VIO el dato, que vale 7 días (D-38). Insumo de la disponibilidad que usa M12 Accesibilidad (RN-04). Dueño: availability-service.';

COMMIT;
