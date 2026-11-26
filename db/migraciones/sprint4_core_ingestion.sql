-- D-33/D-34: procedencia para ventas confirmadas por el servicio de ingesta.
BEGIN;
ALTER TYPE canal_transaccion ADD VALUE IF NOT EXISTS 'importacion_archivo';
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS lote_ingesta_id UUID;
COMMENT ON COLUMN transacciones.lote_ingesta_id IS
    'Identificador del lote en transactions-ingestion-service. La referencia se obtiene por HTTP.';
COMMIT;
