-- =====================================================================
-- Sprint 4 · pricing-service: observaciones de precio idempotentes (D-42)
--
-- Para una base que YA existe. `db/schema.sql` ya trae la columna para un
-- volumen nuevo. Idempotente: se puede correr varias veces.
--
--   docker exec -i retail_postgres psql -U retail_user -d retaildb --     < db/migraciones/sprint4_pricing_observaciones.sql
-- =====================================================================

BEGIN;

-- Id generado en el dispositivo (app móvil / offline-sync). NULL = alta sin id (web):
-- varios NULL no chocan con la restricción UNIQUE.
ALTER TABLE precios_observados ADD COLUMN IF NOT EXISTS observacion_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'precios_observados_observacion_id_key'
  ) THEN
    ALTER TABLE precios_observados ADD CONSTRAINT precios_observados_observacion_id_key UNIQUE (observacion_id);
  END IF;
END $$;

COMMENT ON COLUMN precios_observados.observacion_id IS 'Id generado en el dispositivo (D-42): un reenvío con el mismo id devuelve la observación original. Dueño: pricing-service.';

COMMIT;
