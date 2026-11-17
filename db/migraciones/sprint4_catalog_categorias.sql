-- =====================================================================
-- Sprint 4 · catalog-service (T-21, D-07)
--
-- Para una base que YA existe (volumen creado antes de este cambio).
-- `db/schema.sql` ya trae la columna para un volumen nuevo; este archivo
-- lleva una base vieja al mismo estado SIN recrear el volumen ni perder
-- datos. Es idempotente: se puede correr varias veces.
--
--   docker exec -i retail_postgres psql -U retail_user -d retaildb \
--     < db/migraciones/sprint4_catalog_categorias.sql
-- =====================================================================

ALTER TABLE categorias_producto
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
